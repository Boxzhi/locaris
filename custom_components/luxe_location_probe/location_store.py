"""Opt-in location storage probe. No active location requests."""
import asyncio
from contextlib import closing
from datetime import datetime, timedelta, timezone
import logging
import math
from pathlib import Path
import sqlite3
import time

from homeassistant.core import callback
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval

_LOGGER = logging.getLogger(__name__)
WINDOW = 30 * 86400 * 1000

def now_ms():
    return int(time.time() * 1000)

def position(state):
    if state is None or state.state in ("unknown", "unavailable"):
        return None
    a = state.attributes
    if a.get("source_type") != "gps":
        return None
    lat, lon, acc = a.get("latitude"), a.get("longitude"), a.get("gps_accuracy")
    valid = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
    if not valid(lat) or not valid(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return None
    return (float(lat), float(lon), float(acc) if valid(acc) and acc >= 0 else None)

def point(state):
    p = position(state)
    if p is None:
        return None
    return (int(state.last_updated.timestamp() * 1000), *p)

class Store:
    def __init__(self, hass):
        self.hass = hass
        self.path = Path(hass.config.path("luxe_location", "location.db"))
        self.lock = asyncio.Lock()
        self.devices = set()
        self.managed = set()
        self.excluded = set()
        self.discovery = None
        self.importing = {}
        self.generations = {}
        self.initialized = False
        self.unsub = None
        self.timer = None
        self.active = True
        self.ready = False
        self.tasks = set()
        self.last_cleanup = None
        self.stop_lock = asyncio.Lock()

    def db(self, fn, *args):
        with closing(sqlite3.connect(self.path, timeout=10)) as con:
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA foreign_keys=ON")
            con.execute("PRAGMA secure_delete=ON")
            with con:
                return fn(con, *args)

    async def run(self, fn, *args):
        return await self.hass.async_add_executor_job(self.db, fn, *args)

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=10)) as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.execute("PRAGMA foreign_keys=ON")
            con.execute("PRAGMA secure_delete=ON")
            with con:
                con.executescript("""
                    CREATE TABLE IF NOT EXISTS probe_management (entity_id TEXT PRIMARY KEY, excluded INTEGER NOT NULL DEFAULT 0);
                    CREATE TABLE IF NOT EXISTS probe_paused (entity_id TEXT PRIMARY KEY);
                    CREATE TABLE IF NOT EXISTS probe_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS probe_devices (
                      entity_id TEXT PRIMARY KEY,
                      consent_at INTEGER NOT NULL,
                      import_from INTEGER NOT NULL,
                      history_cursor INTEGER NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS probe_locations (
                      entity_id TEXT NOT NULL REFERENCES probe_devices(entity_id) ON DELETE CASCADE,
                      recorded_at INTEGER NOT NULL,
                      latitude REAL NOT NULL,
                      longitude REAL NOT NULL,
                      accuracy REAL,
                      source TEXT NOT NULL,
                      PRIMARY KEY(entity_id, recorded_at)
                    );
                    CREATE INDEX IF NOT EXISTS probe_location_time ON probe_locations(recorded_at);
                    CREATE TABLE IF NOT EXISTS probe_address_cache (
                      entity_id TEXT NOT NULL REFERENCES probe_devices(entity_id) ON DELETE CASCADE,
                      lon REAL NOT NULL, lat REAL NOT NULL, address TEXT NOT NULL,
                      created_at INTEGER NOT NULL,
                      PRIMARY KEY(entity_id,lon,lat)
                    );
                    CREATE INDEX IF NOT EXISTS probe_address_time ON probe_address_cache(created_at);
                """)
                con.execute("INSERT OR IGNORE INTO probe_management SELECT entity_id,0 FROM probe_devices")
                return ([r[0] for r in con.execute("SELECT entity_id FROM probe_devices WHERE entity_id NOT IN (SELECT entity_id FROM probe_paused)")],
                        [(r[0],r[1]) for r in con.execute("SELECT entity_id,excluded FROM probe_management")])

    async def start(self):
        recording, management = await self.hass.async_add_executor_job(self.initialize)
        self.initialized = True
        self.managed = {e for e, excluded in management if not excluded}
        self.excluded = {e for e, excluded in management if excluded}
        self.devices = set(recording) & self.managed
        await self.migrate_discovery()
        await self.discover()
        self.listen()
        self.timer = async_track_time_interval(self.hass, self.periodic, timedelta(hours=1))
        await self.cleanup()
        self.ready = True
        self.discovery = async_track_time_interval(self.hass, self.scan_tick, timedelta(minutes=1))
        for entity in sorted(self.devices):
            self.schedule_backfill(entity)

    async def migrate_discovery(self):
        # v0.0.5 automatically admitted GPS entities without coordinates.
        # Only remove legacy unrecorded entries whose current GPS entity lacks
        # a valid position. Exclusions and existing historical data are retained.
        candidates = {e for e in self.managed
                      if (state := self.hass.states.get(e)) is not None
                      and state.attributes.get("source_type") == "gps"
                      and position(state) is None}
        def migrate(c):
            if c.execute("SELECT 1 FROM probe_metadata WHERE key='valid_position_discovery_v1'").fetchone():
                return []
            removed = []
            for e in candidates:
                if c.execute("SELECT 1 FROM probe_devices WHERE entity_id=?", (e,)).fetchone() or c.execute("SELECT 1 FROM probe_paused WHERE entity_id=?", (e,)).fetchone():
                    continue
                c.execute("DELETE FROM probe_management WHERE entity_id=? AND excluded=0", (e,))
                removed.append(e)
            c.execute("INSERT INTO probe_metadata VALUES ('valid_position_discovery_v1','1')")
            return removed
        async with self.lock:
            removed = await self.run(migrate)
            self.managed.difference_update(removed)

    async def discover(self):
        candidates = {s.entity_id for s in self.hass.states.async_all("device_tracker")
                      if position(s) is not None}
        async with self.lock:
            if not self.active:
                return
            new = {e for e in candidates - self.managed - self.excluded
                   if position(self.hass.states.get(e)) is not None}
            if new:
                await self.run(lambda c: c.executemany("INSERT OR IGNORE INTO probe_management VALUES (?,0)", [(e,) for e in new]))
                self.managed.update(new)

    async def scan_tick(self, _now):
        await self.discover()

    async def add(self, entity):
        state = self.hass.states.get(entity)
        if not entity.startswith("device_tracker.") or (entity not in self.excluded and (state is None or state.attributes.get("source_type") != "gps")):
            raise ValueError("not_gps")
        async with self.lock:
            if not self.active or not self.ready:
                raise ValueError("not_loaded")
            await self.run(lambda c: c.execute("INSERT INTO probe_management VALUES (?,0) ON CONFLICT(entity_id) DO UPDATE SET excluded=0", (entity,)))
            self.excluded.discard(entity)
            self.managed.add(entity)

    async def remove(self, entity, delete_history):
        async with self.lock:
            if not self.active or not self.ready or entity not in self.managed:
                raise ValueError("not_managed")
            def remove_db(c):
                c.execute("INSERT INTO probe_management VALUES (?,1) ON CONFLICT(entity_id) DO UPDATE SET excluded=1", (entity,))
                c.execute("INSERT OR IGNORE INTO probe_paused VALUES (?)", (entity,))
                if delete_history:
                    c.execute("DELETE FROM probe_address_cache WHERE entity_id=?", (entity,))
                    c.execute("DELETE FROM probe_devices WHERE entity_id=?", (entity,))
                else:
                    now = now_ms()
                    c.execute("UPDATE probe_devices SET consent_at=?,import_from=?,history_cursor=? WHERE entity_id=?", (now,now,now,entity))
            await self.run(remove_db)
            self.invalidate(entity)
            self.devices.discard(entity)
            self.managed.discard(entity)
            self.excluded.add(entity)
            self.listen()
            await self.hass.async_add_executor_job(self.checkpoint)

    @callback
    def invalidate(self, entity):
        self.generations[entity] = self.generations.get(entity, 0) + 1

    @callback
    def schedule_backfill(self, entity):
        if not self.active or not self.ready or entity not in self.devices:
            return
        generation = self.generations.get(entity, 0)
        if self.importing.get(entity) == generation:
            return
        self.importing[entity] = generation
        self.spawn(self.backfill(entity, generation))

    @callback
    def spawn(self, coro):
        task = self.hass.async_create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    @callback
    def listen(self):
        if self.unsub:
            self.unsub()
            self.unsub = None
        if self.active and self.devices:
            self.unsub = async_track_state_change_event(self.hass, list(self.devices), self.changed)

    @callback
    def changed(self, event):
        if not self.active or not self.ready:
            return
        entity = event.data["entity_id"]
        new, old = event.data.get("new_state"), event.data.get("old_state")
        p = point(new)
        # Restored state or first appearance after restart is not evidence of a fresh GPS sample.
        if old is None or p is None or position(old) == position(new):
            return
        self.spawn(self.write(entity, p, self.generations.get(entity, 0)))

    @staticmethod
    def insert(con, entity, rows, source, cursor=None):
        device = con.execute("SELECT import_from FROM probe_devices WHERE entity_id=?", (entity,)).fetchone()
        if device is None:
            return 0
        now = now_ms()
        cutoff = max(now - WINDOW, device["import_from"])
        before = con.total_changes
        con.executemany("INSERT OR IGNORE INTO probe_locations VALUES (?,?,?,?,?,?)",
                        [(entity, *p, source) for p in rows if cutoff <= p[0] <= now])
        count = con.total_changes - before
        if cursor is not None:
            con.execute("UPDATE probe_devices SET history_cursor=MAX(history_cursor,?) WHERE entity_id=?", (cursor, entity))
        return count

    async def write(self, entity, p, generation):
        try:
            async with self.lock:
                if self.active and self.ready and entity in self.devices and self.generations.get(entity, 0) == generation:
                    await self.run(self.insert, entity, [p], "state_change")
        except Exception:
            _LOGGER.warning("Location probe write failed (no coordinates logged)")

    async def enable(self, entity, import_history):
        state = self.hass.states.get(entity)
        if not entity.startswith("device_tracker.") or state is None or state.attributes.get("source_type") != "gps":
            raise ValueError("not_gps")
        async with self.lock:
            if not self.active or not self.ready or entity not in self.managed:
                raise ValueError("not_managed")
            if entity in self.devices:
                return
            now = now_ms()
            def enable_db(c):
                paused = c.execute("SELECT 1 FROM probe_paused WHERE entity_id=?", (entity,)).fetchone()
                cutoff = now - WINDOW if import_history and not paused else now
                c.execute("INSERT INTO probe_devices VALUES (?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET consent_at=excluded.consent_at,import_from=excluded.import_from,history_cursor=excluded.history_cursor", (entity,now,cutoff,cutoff))
                c.execute("DELETE FROM probe_paused WHERE entity_id=?", (entity,))
            await self.run(enable_db)
            self.invalidate(entity)
            self.devices.add(entity)
            self.listen()
        self.schedule_backfill(entity)

    async def disable(self, entity):
        async with self.lock:
            if not self.active or not self.ready or entity not in self.managed:
                raise ValueError("not_managed")
            if entity not in self.devices:
                return
            def pause_db(c):
                c.execute("INSERT OR IGNORE INTO probe_paused VALUES (?)", (entity,))
                now = now_ms()
                c.execute("UPDATE probe_devices SET consent_at=?,import_from=?,history_cursor=? WHERE entity_id=?", (now,now,now,entity))
            await self.run(pause_db)
            self.invalidate(entity)
            self.devices.discard(entity)
            self.listen()
            await self.hass.async_add_executor_job(self.checkpoint)

    async def backfill(self, entity, generation):
        try:
            from homeassistant.components.recorder import get_instance, history
            async with self.lock:
                if not self.active or entity not in self.devices or self.generations.get(entity, 0) != generation:
                    return
                row = await self.run(lambda c: tuple(c.execute("SELECT consent_at,import_from,history_cursor FROM probe_devices WHERE entity_id=?", (entity,)).fetchone()))
            consent, earliest, cursor = row
            end = now_ms() - 120000
            start = max(earliest, cursor - 300000, now_ms() - WINDOW)
            # Query in bounded daily windows, preserving original HA record timestamps.
            while start < end and self.active and self.generations.get(entity, 0) == generation:
                stop = min(start + 86400000, end)
                begin_dt = datetime.fromtimestamp(start / 1000, timezone.utc)
                end_dt = datetime.fromtimestamp(stop / 1000, timezone.utc)
                def read():
                    return history.get_significant_states(self.hass, begin_dt, end_dt, [entity],
                        include_start_time_state=False, significant_changes_only=False,
                        minimal_response=False, no_attributes=False)
                result = await get_instance(self.hass).async_add_executor_job(read)
                rows = []
                prev = None
                for state in result.get(entity, []):
                    p = point(state)
                    if p is None:
                        continue
                    if prev is None or p[1:] != prev:
                        rows.append(p)
                    prev = p[1:]
                async with self.lock:
                    if not self.active or entity not in self.devices or self.generations.get(entity, 0) != generation:
                        return
                    current = await self.run(lambda c: c.execute("SELECT consent_at FROM probe_devices WHERE entity_id=?", (entity,)).fetchone())
                    if current is None or current[0] != consent:
                        return
                    await self.run(self.insert, entity, rows, "recorder", stop)
                start = stop
        except asyncio.CancelledError:
            raise
        except Exception:
            _LOGGER.warning("Location probe Recorder import failed (no coordinates logged)")
        finally:
            if self.importing.get(entity) == generation:
                self.importing.pop(entity, None)

    def checkpoint(self):
        with closing(sqlite3.connect(self.path, timeout=10)) as con:
            con.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    async def cleanup(self):
        async with self.lock:
            if not self.active:
                return
            cutoff = now_ms() - WINDOW
            def prune(c):
                c.execute("DELETE FROM probe_locations WHERE recorded_at < ?", (cutoff,))
                c.execute("DELETE FROM probe_address_cache WHERE created_at < ?", (cutoff,))
            await self.run(prune)
            await self.hass.async_add_executor_job(self.checkpoint)
            self.last_cleanup = now_ms()

    async def periodic(self, _now):
        if self.active:
            await self.cleanup()
            if not self.active:
                return
            for entity in sorted(self.devices):
                self.schedule_backfill(entity)

    @staticmethod
    def cached_address(con, entity, lon, lat):
        # Use a bounding box for the index lookup, then an actual distance test.
        radius = 30
        dy = radius / 111000
        dx = min(180, dy / max(.001, abs(math.cos(math.radians(lat)))))
        rows = con.execute("""SELECT lon,lat,address,created_at FROM probe_address_cache
            WHERE entity_id=? AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?
            AND created_at>=?""", (entity,lon-dx,lon+dx,lat-dy,lat+dy,now_ms()-WINDOW)).fetchall()
        best = None
        for row in rows:
            distance = math.hypot((row["lon"]-lon)*111000*math.cos(math.radians(lat)),(row["lat"]-lat)*111000)
            if distance <= radius and (best is None or distance < best[0]):
                best = (distance,row["address"],row["created_at"])
        return best

    @staticmethod
    def save_address(con, entity, lon, lat, address):
        con.execute("INSERT INTO probe_address_cache VALUES (?,?,?,?,?) ON CONFLICT(entity_id,lon,lat) DO UPDATE SET address=excluded.address,created_at=excluded.created_at", (entity,lon,lat,address,now_ms()))
        # Bound storage independently of the retention window.
        con.execute("DELETE FROM probe_address_cache WHERE rowid IN (SELECT rowid FROM probe_address_cache ORDER BY created_at DESC LIMIT -1 OFFSET 10000)")

    async def storage_stats(self):
        def read(con):
            cutoff = now_ms() - WINDOW
            location_count = con.execute("""SELECT COUNT(l.recorded_at)
                FROM probe_devices d JOIN probe_locations l
                ON d.entity_id=l.entity_id WHERE l.recorded_at>=?""",
                (cutoff,)).fetchone()[0]
            address_count = con.execute(
                "SELECT COUNT(*) FROM probe_address_cache WHERE created_at>=?",
                (cutoff,)).fetchone()[0]
            return location_count, address_count
        async with self.lock:
            if not self.active or not self.ready:
                raise RuntimeError("Storage not ready")
            location_count, address_count = await self.run(read)
            size = await self.hass.async_add_executor_job(lambda: sum(p.stat().st_size for p in self.path.parent.glob("location.db*") if p.is_file()))
        return {"retention_days":30,"database_bytes":size,"last_cleanup":self.last_cleanup,"location_count":location_count,"address_cache_count":address_count}

    async def stop(self):
        async with self.stop_lock:
            self.active = False
            self.ready = False
            for name in ("unsub", "timer", "discovery"):
                unsubscribe = getattr(self, name)
                setattr(self, name, None)
                if unsubscribe:
                    try:
                        unsubscribe()
                    except Exception:
                        _LOGGER.warning("Location listener cleanup failed")
            if self.tasks:
                await asyncio.gather(*list(self.tasks), return_exceptions=True)
            async with self.lock:
                if self.initialized:
                    await self.hass.async_add_executor_job(self.checkpoint)
                    self.initialized = False
            self.importing.clear()
