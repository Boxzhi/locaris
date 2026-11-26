"""Opt-in Locaris location storage. No active location requests."""
import asyncio
from contextlib import closing
from datetime import datetime, timedelta, timezone
import logging
import json
import math
from pathlib import Path
import sqlite3
import time

from .history_logic import recorder_changes, migrate_change_only, compact_repeated
from .history_sync import HistorySync
from .live_position_clock import LivePositionClock, last_recorded_change
from .const import (WINDOW, HISTORY_RETENTION_DAYS, DAY_MS,
    BACKFILL_RETRY_S, BACKFILL_OVERLAP_MS, RECORDER_MIN_DELAY_MS,
    RECORDER_DEFAULT_COMMIT_S, RECORDER_COMMIT_BUFFER_MS, RECORDER_BOUNDARY_MS,
    WARNING_INTERVAL_S, SQLITE_START_TIMEOUT_S, SQLITE_BUSY_TIMEOUT_S, SQLITE_RETRY_DELAY_S,
    SCHEDULER_TICK_S, DISCOVERY_QUEUE_LIMIT)
from .runtime_policy import DEFAULT_POLICY, POLICY_KEY, validate_patch, Schedule
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import callback
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval

_LOGGER = logging.getLogger(__name__)

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
    stamp = state.last_updated
    if stamp is None or stamp.tzinfo is None:
        return None
    return (int(stamp.timestamp() * 1000), *p)

class Store:
    def __init__(self, hass):
        self.hass = hass
        self.path = Path(hass.config.path("locaris", "location.db"))
        self.lock = asyncio.Lock()
        self.devices = set()
        self.managed = set()
        self.excluded = set()
        self.discovery_listener = None
        self.discovery_pending = set()
        self.discovery_task = None
        self.discovery_full_task = None
        self.cleanup_task = None
        self.policy = dict(DEFAULT_POLICY)
        self.schedule = None
        self.history_sync = HistorySync()
        self.importing = {}
        self.retry_import = {}
        self.recovery_from = {}
        self.backfill_active = set()
        self.backfill_pending = {}
        self.pending_writes = 0
        self.warning_times = {}
        self.generations = {}
        self.live_clock = LivePositionClock()
        self.last_valid = {}
        self.initialized = False
        self.unsub = None
        self.timer = None
        self.active = True
        self.ready = False
        self.tasks = set()
        self.last_cleanup = None
        self.stop_lock = asyncio.Lock()

    def db(self, fn, *args):
        # Never silently create a replacement database after startup.
        # A failed transaction is rolled back before the single BUSY retry.
        for attempt in range(2):
            try:
                with closing(sqlite3.connect(self.path.as_uri()+"?mode=rw", uri=True, timeout=SQLITE_BUSY_TIMEOUT_S)) as con:
                    con.row_factory = sqlite3.Row
                    con.execute("PRAGMA foreign_keys=ON")
                    con.execute("PRAGMA secure_delete=ON")
                    with con:
                        return fn(con, *args)
            except sqlite3.OperationalError as err:
                code = getattr(err, "sqlite_errorcode", None)
                if attempt or code is None or (code & 255) not in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                    raise
                time.sleep(SQLITE_RETRY_DELAY_S)

    async def run(self, fn, *args):
        return await self.hass.async_add_executor_job(self.db, fn, *args)

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=SQLITE_START_TIMEOUT_S)) as con:
            if con.execute("PRAGMA quick_check(1)").fetchone()[0] != "ok":
                raise sqlite3.DatabaseError("Location database integrity check failed")
            tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            required = {"locaris_management", "locaris_paused", "locaris_metadata",
                        "locaris_devices", "locaris_locations", "locaris_address_cache"}
            if tables and not required.issubset(tables):
                raise sqlite3.DatabaseError("Unexpected Locaris database schema")
            con.execute("PRAGMA journal_mode=WAL")
            con.execute("PRAGMA foreign_keys=ON")
            con.execute("PRAGMA secure_delete=ON")
            with con:
                con.executescript("""
                    CREATE TABLE IF NOT EXISTS locaris_management (entity_id TEXT PRIMARY KEY, excluded INTEGER NOT NULL DEFAULT 0);
                    CREATE TABLE IF NOT EXISTS locaris_paused (entity_id TEXT PRIMARY KEY);
                    CREATE TABLE IF NOT EXISTS locaris_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS locaris_devices (
                      entity_id TEXT PRIMARY KEY,
                      consent_at INTEGER NOT NULL,
                      import_from INTEGER NOT NULL,
                      history_cursor INTEGER NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS locaris_locations (
                      entity_id TEXT NOT NULL REFERENCES locaris_devices(entity_id) ON DELETE CASCADE,
                      recorded_at INTEGER NOT NULL,
                      latitude REAL NOT NULL,
                      longitude REAL NOT NULL,
                      accuracy REAL,
                      source TEXT NOT NULL,
                      PRIMARY KEY(entity_id, recorded_at)
                    );
                    CREATE INDEX IF NOT EXISTS locaris_location_time ON locaris_locations(recorded_at);
                    CREATE TABLE IF NOT EXISTS locaris_address_cache (
                      entity_id TEXT NOT NULL REFERENCES locaris_devices(entity_id) ON DELETE CASCADE,
                      lon REAL NOT NULL, lat REAL NOT NULL, address TEXT NOT NULL,
                      created_at INTEGER NOT NULL,
                      PRIMARY KEY(entity_id,lon,lat)
                    );
                    CREATE INDEX IF NOT EXISTS locaris_address_time ON locaris_address_cache(created_at);
                """)
                return ([r[0] for r in con.execute("SELECT entity_id FROM locaris_devices WHERE entity_id NOT IN (SELECT entity_id FROM locaris_paused)")],
                        [(r[0],r[1]) for r in con.execute("SELECT entity_id,excluded FROM locaris_management")])

    async def start(self):
        recording, management = await self.hass.async_add_executor_job(self.initialize)
        self.initialized = True
        self.managed = {e for e, excluded in management if not excluded}
        self.excluded = {e for e, excluded in management if excluded}
        self.devices = set(recording) & self.managed
        await self.load_policy()
        self.history_sync.pruned(await self.run(migrate_change_only, sorted(self.devices), now_ms()-WINDOW))
        # A persisted predecessor prevents a restart from creating a fresh anchor.
        def baselines(con):
            values = {}
            for entity in self.devices:
                row = con.execute("SELECT latitude,longitude,accuracy FROM locaris_locations "
                                  "WHERE entity_id=? AND recorded_at>=MAX(?,(SELECT import_from FROM locaris_devices WHERE entity_id=?)) "
                                  "ORDER BY recorded_at DESC LIMIT 1", (entity, now_ms()-WINDOW, entity)).fetchone()
                if row is not None:
                    values[entity] = tuple(row)
                else:
                    consent = con.execute("SELECT import_from FROM locaris_devices WHERE entity_id=?", (entity,)).fetchone()
                    if consent is not None and consent[0] < now_ms()-WINDOW:
                        # All retained history may have expired while stationary.
                        # Seed memory only after restart, never synthesize a new point.
                        values[entity] = None
            return values
        for entity, payload in (await self.run(baselines)).items():
            if payload is None:
                payload = position(self.hass.states.get(entity))
            if payload is not None:
                self.last_valid[entity] = payload
        await self.discover()
        await self.cleanup()
        for entity in self.managed:
            self.live_clock.seed(entity, position(self.hass.states.get(entity)))
        self.ready = True
        self.listen()
        self.schedule = Schedule(self.policy, time.monotonic())
        self.discovery_listener = self.hass.bus.async_listen(EVENT_STATE_CHANGED, self.discovery_changed)
        self.timer = async_track_time_interval(self.hass, self.scan_tick, timedelta(seconds=SCHEDULER_TICK_S))
        for entity in sorted(self.devices):
            self.schedule_backfill(entity)

    async def load_policy(self):
        row = await self.run(lambda c: c.execute("SELECT value FROM locaris_metadata WHERE key=?", (POLICY_KEY,)).fetchone())
        if row:
            try:
                self.policy = {**DEFAULT_POLICY, **validate_patch(json.loads(row[0]))}
            except (ValueError, TypeError):
                self.warn("Invalid saved location runtime policy; defaults used")

    async def update_policy(self, patch, authorize):
        patch = validate_patch(patch)
        async with self.lock:
            if not self.active or not self.ready or not await authorize() or not self.active or not self.ready:
                raise PermissionError("Location policy unavailable")
            old = self.policy
            new = {**old, **patch}
            if new == old:
                return
            await self.run(lambda c: c.execute(
                "INSERT INTO locaris_metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (POLICY_KEY, json.dumps(new, sort_keys=True))))
            self.policy = new
            if self.active and self.schedule:
                self.schedule.update(old, new, time.monotonic())

    async def discover(self, candidates=None):
        if candidates is None:
            candidates = {s.entity_id for s in self.hass.states.async_all("device_tracker")
                          if position(s) is not None}
        async with self.lock:
            if not self.active:
                return
            new = {e for e in candidates - self.managed - self.excluded
                   if position(self.hass.states.get(e)) is not None}
            if new:
                await self.run(lambda c: c.executemany("INSERT OR IGNORE INTO locaris_management VALUES (?,0)", [(e,) for e in new]))
                self.managed.update(new)
                for entity in new:
                    self.live_clock.seed(entity, position(self.hass.states.get(entity)))

    def warn(self, message):
        now = time.monotonic()
        if now - self.warning_times.get(message, -1000) >= WARNING_INTERVAL_S:
            self.warning_times[message] = now
            _LOGGER.warning(message)

    @callback
    def discovery_changed(self, event):
        if not self.active or not self.ready:
            return
        entity = event.data.get("entity_id", "")
        if not entity.startswith("device_tracker.") or entity in self.excluded:
            return
        if entity in self.managed:
            self.live_clock.observe(entity, point(event.data.get("new_state")), position(event.data.get("old_state")))
            return
        if position(event.data.get("new_state")) is None:
            return
        if len(self.discovery_pending) < DISCOVERY_QUEUE_LIMIT:
            self.discovery_pending.add(entity)
        self.start_discovery_batch()

    @callback
    def start_discovery_batch(self):
        if not self.active or not self.ready or not self.discovery_pending or self.discovery_task:
            return
        task = self.spawn(self.discover_pending())
        if task:
            self.discovery_task = task
            task.add_done_callback(self.discovery_finished)

    @callback
    def discovery_finished(self, task):
        if self.discovery_task is task:
            self.discovery_task = None
            self.start_discovery_batch()

    async def discover_pending(self):
        # One bounded batch; state is revalidated under the database lock.
        pending = set(self.discovery_pending)
        self.discovery_pending.difference_update(pending)
        try:
            await self.discover(pending)
        except (sqlite3.Error, OSError):
            self.warn("Location event discovery deferred (no coordinates logged)")

    async def discover_periodic(self):
        try:
            await self.discover()
        except (sqlite3.Error, OSError):
            self.warn("Location discovery deferred (no coordinates logged)")

    async def cleanup_periodic(self):
        try:
            await self.cleanup()
        except (sqlite3.Error, OSError):
            if self.active and self.schedule:
                self.schedule.defer_cleanup(time.monotonic())
            self.warn("Location periodic cleanup failed (no coordinates logged)")

    @callback
    def scan_tick(self, _now):
        if not self.active or not self.ready or not self.schedule:
            return
        now = time.monotonic()
        # Retry deadlines are independent of discovery, cleanup and normal backfill.
        for entity, deadline in list(self.retry_import.items()):
            if now >= deadline:
                self.schedule_backfill(entity)
        discovery, backfill, cleanup = self.schedule.due(self.policy, now)
        if discovery and (self.discovery_full_task is None or self.discovery_full_task.done()):
            self.discovery_full_task = self.spawn(self.discover_periodic())
        if backfill:
            for entity in sorted(self.devices):
                if self.retry_import.get(entity, 0) <= now:
                    self.schedule_backfill(entity)
        if cleanup and (self.cleanup_task is None or self.cleanup_task.done()):
            self.cleanup_task = self.spawn(self.cleanup_periodic())
        self.start_discovery_batch()

    async def add(self, entity):
        state = self.hass.states.get(entity)
        if not entity.startswith("device_tracker.") or (entity not in self.excluded and (state is None or state.attributes.get("source_type") != "gps")):
            raise ValueError("not_gps")
        async with self.lock:
            if not self.active or not self.ready:
                raise ValueError("not_loaded")
            await self.run(lambda c: c.execute("INSERT INTO locaris_management VALUES (?,0) ON CONFLICT(entity_id) DO UPDATE SET excluded=0", (entity,)))
            self.excluded.discard(entity)
            self.managed.add(entity)
            self.live_clock.seed(entity, position(self.hass.states.get(entity)))

    async def remove(self, entity, delete_history):
        async with self.lock:
            if not self.active or not self.ready or entity not in self.managed:
                raise ValueError("not_managed")
            def remove_db(c):
                c.execute("INSERT INTO locaris_management VALUES (?,1) ON CONFLICT(entity_id) DO UPDATE SET excluded=1", (entity,))
                c.execute("INSERT OR IGNORE INTO locaris_paused VALUES (?)", (entity,))
                if delete_history:
                    c.execute("DELETE FROM locaris_address_cache WHERE entity_id=?", (entity,))
                    c.execute("DELETE FROM locaris_devices WHERE entity_id=?", (entity,))
                else:
                    now = now_ms()
                    c.execute("UPDATE locaris_devices SET consent_at=?,import_from=?,history_cursor=? WHERE entity_id=?", (now,now,now,entity))
            await self.run(remove_db)
            self.invalidate(entity)
            self.devices.discard(entity)
            self.managed.discard(entity)
            self.live_clock.discard(entity)
            self.excluded.add(entity)
            self.listen()
            await self.checkpoint_safely()

    @callback
    def invalidate(self, entity):
        self.generations[entity] = self.generations.get(entity, 0) + 1
        self.history_sync.invalidate(entity)
        self.last_valid.pop(entity, None)
        self.retry_import.pop(entity, None)
        self.recovery_from.pop(entity, None)
        self.backfill_pending.pop(entity, None)

    @callback
    def schedule_backfill(self, entity):
        if not self.active or not self.ready or entity not in self.devices:
            return
        generation = self.generations.get(entity, 0)
        key = (entity, generation)
        if key in self.backfill_active:
            return
        self.retry_import.pop(entity, None)
        if len(self.backfill_active) >= 2:
            self.backfill_pending[entity] = generation
            return
        self.backfill_pending.pop(entity, None)
        self.backfill_active.add(key)
        self.importing[entity] = generation
        task = self.spawn(self.backfill(entity, generation))
        if task is None:
            self.backfill_active.discard(key)
            if self.importing.get(entity) == generation:
                self.importing.pop(entity, None)
            self.defer_backfill(entity, generation)
            return
        task.add_done_callback(lambda completed: self.backfill_finished(entity, generation, completed))

    @callback
    def backfill_finished(self, entity, generation, task):
        # A task cancelled before its first instruction never reaches its finally.
        self.backfill_active.discard((entity, generation))
        if self.importing.get(entity) == generation:
            self.importing.pop(entity, None)
        if task.cancelled():
            self.defer_backfill(entity, generation)
        self.drain_backfills()

    @callback
    def drain_backfills(self):
        if not self.active or not self.ready:
            return
        while self.backfill_pending and len(self.backfill_active) < 2:
            entity = next(iter(self.backfill_pending))
            generation = self.backfill_pending.pop(entity)
            if entity in self.devices and self.generations.get(entity, 0) == generation:
                self.schedule_backfill(entity)

    @callback
    def spawn(self, coro):
        try:
            task = self.hass.async_create_task(coro)
        except Exception:
            coro.close()
            self.warn("Location background task creation failed")
            return None
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    @callback
    def listen(self):
        if self.unsub:
            unsubscribe, self.unsub = self.unsub, None
            try:
                unsubscribe()
            except Exception:
                # Do not register a second listener if the previous one may remain.
                self.unsub = unsubscribe
                self.warn("Location listener replacement deferred")
                return
        if self.active and self.devices:
            self.unsub = async_track_state_change_event(self.hass, list(self.devices), self.changed)

    @callback
    def changed(self, event):
        if not self.active or not self.ready:
            return
        entity = event.data["entity_id"]
        new, old = event.data.get("new_state"), event.data.get("old_state")
        if entity not in self.devices:
            return
        p = point(new)
        if p is None:
            return
        previous = self.last_valid.get(entity)
        old_payload = position(old)
        self.last_valid[entity] = p[1:]
        # Preserve an actual transition even if the persisted predecessor
        # happens to match the new payload (an intervening point may be pending).
        actual_change = old_payload is not None and old_payload != p[1:]
        if previous == p[1:] and not actual_change:
            return
        initial = not actual_change and (previous is None or old_payload is not None)
        generation = self.generations.get(entity, 0)
        if self.pending_writes >= 256:
            self.defer_backfill(entity, generation, p[0])
            self.warn("Location write queue full; Recorder recovery requested (no coordinates logged)")
            return
        task = self.spawn(self.write(entity, p, generation, initial))
        if task is None:
            self.defer_backfill(entity, generation, p[0])
            return
        self.pending_writes += 1
        task.add_done_callback(self.write_finished)

    @callback
    def write_finished(self, _task):
        self.pending_writes = max(0, self.pending_writes - 1)

    @staticmethod
    def insert(con, entity, rows, source, cursor=None):
        device = con.execute("SELECT import_from FROM locaris_devices WHERE entity_id=?", (entity,)).fetchone()
        if device is None:
            return 0
        now = now_ms()
        cutoff = max(now - WINDOW, device["import_from"])
        before = con.total_changes
        eligible = sorted((p for p in rows if cutoff <= p[0] <= now), key=lambda p: p[0])
        for row in eligible:
            p = row[:4]
            row_source = row[4] if source == "recorder" and len(row) == 5 else source
            if row_source in ("state_change_initial", "enable_snapshot", "recorder_initial"):
                prior = con.execute("SELECT latitude,longitude,accuracy FROM locaris_locations "
                                    "WHERE entity_id=? AND recorded_at>=? AND recorded_at<? ORDER BY recorded_at DESC LIMIT 1",
                                    (entity, cutoff, p[0])).fetchone()
                if prior is not None and tuple(prior) == tuple(p[1:]):
                    continue
            con.execute("INSERT OR IGNORE INTO locaris_locations VALUES (?,?,?,?,?,?)", (entity, *p, row_source))
        if source == "recorder" and eligible:
            compact_repeated(con, entity, cutoff, affected_from=eligible[0][0])
        count = con.total_changes - before
        if cursor is not None:
            con.execute("UPDATE locaris_devices SET history_cursor=MAX(history_cursor,?) WHERE entity_id=?", (cursor, entity))
        return count

    async def write(self, entity, p, generation, initial=False):
        try:
            async with self.lock:
                if self.active and self.ready and entity in self.devices and self.generations.get(entity, 0) == generation:
                    count = await self.run(self.insert, entity, [p], "state_change_initial" if initial else "state_change")
                    self.history_sync.changed(entity, count)
        except Exception:
            self.defer_backfill(entity, generation, p[0])
            self.warn("Location write failed (no coordinates logged)")

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
                paused = c.execute("SELECT 1 FROM locaris_paused WHERE entity_id=?", (entity,)).fetchone()
                cutoff = now - WINDOW if import_history and not paused else now
                c.execute("INSERT INTO locaris_devices VALUES (?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET consent_at=excluded.consent_at,import_from=excluded.import_from,history_cursor=excluded.history_cursor", (entity,now,cutoff,cutoff))
                c.execute("DELETE FROM locaris_paused WHERE entity_id=?", (entity,))
            await self.run(enable_db)
            self.invalidate(entity)
            self.devices.add(entity)
            self.listen()
            # Capture an already available position only on explicit authorization.
            # The timestamp is observation time, not the phone's GPS sample time.
            payload = position(self.hass.states.get(entity))
            if payload is not None:
                stamp = now_ms()
                self.last_valid[entity] = payload
                try:
                    count = await self.run(self.insert, entity, [(stamp, *payload)], "enable_snapshot")
                    self.history_sync.changed(entity, count)
                except (sqlite3.Error, OSError):
                    self.last_valid.pop(entity, None)
                    self.defer_backfill(entity, self.generations.get(entity, 0), stamp)
                    self.warn("Initial location snapshot failed (no coordinates logged)")
        self.schedule_backfill(entity)

    async def disable(self, entity):
        async with self.lock:
            if not self.active or not self.ready or entity not in self.managed:
                raise ValueError("not_managed")
            if entity not in self.devices:
                return
            def pause_db(c):
                c.execute("INSERT OR IGNORE INTO locaris_paused VALUES (?)", (entity,))
                now = now_ms()
                c.execute("UPDATE locaris_devices SET consent_at=?,import_from=?,history_cursor=? WHERE entity_id=?", (now,now,now,entity))
            await self.run(pause_db)
            self.invalidate(entity)
            self.devices.discard(entity)
            self.listen()
            await self.checkpoint_safely()

    @staticmethod
    def recorder_available(recorder):
        ready = getattr(recorder, "async_db_ready", None)
        return bool(ready is not None and ready.done() and not ready.cancelled() and ready.result() and getattr(recorder, "recording", True) and getattr(recorder, "enabled", True))

    def defer_backfill(self, entity, generation, recorded_at=None):
        if self.active and entity in self.devices and self.generations.get(entity, 0) == generation:
            self.retry_import.setdefault(entity, time.monotonic() + BACKFILL_RETRY_S)
            if recorded_at is not None:
                self.recovery_from[entity] = min(recorded_at, self.recovery_from.get(entity, recorded_at))

    async def backfill(self, entity, generation):
        try:
            from homeassistant.components.recorder import get_instance, history
            async with self.lock:
                if not self.active or entity not in self.devices or self.generations.get(entity, 0) != generation:
                    return
                row = await self.run(lambda c: c.execute("SELECT consent_at,import_from,history_cursor FROM locaris_devices WHERE entity_id=?", (entity,)).fetchone())
            if row is None:
                return
            consent, earliest, cursor = row
            recorder = get_instance(self.hass)
            if not self.recorder_available(recorder):
                self.defer_backfill(entity, generation)
                return
            # Respect long Recorder commit intervals before advancing the cursor.
            delay = max(RECORDER_MIN_DELAY_MS, int(getattr(recorder, "commit_interval", RECORDER_DEFAULT_COMMIT_S)*2000+RECORDER_COMMIT_BUFFER_MS))
            end = now_ms() - delay
            recovery = self.recovery_from.get(entity)
            start = max(earliest, min(cursor - BACKFILL_OVERLAP_MS, recovery) if recovery is not None else cursor - BACKFILL_OVERLAP_MS, now_ms() - WINDOW)
            # Query with one millisecond of overlap at strict Recorder boundaries.
            # The explicit half-open filter below prevents synthetic or future rows.
            # Carry the last valid payload across windows, not across consent changes.
            # A persisted predecessor is a fallback if Recorder cannot provide
            # its start state (for example after a database outage).
            # Without a known in-consent predecessor, retain the first real
            # sample as an anchor instead of trusting a synthetic prior state.
            previous = None
            async with self.lock:
                if not self.active or entity not in self.devices or self.generations.get(entity, 0) != generation:
                    return
                baseline = await self.run(lambda c: c.execute(
                    "SELECT recorded_at,latitude,longitude,accuracy FROM locaris_locations WHERE entity_id=? AND recorded_at>=? AND recorded_at<? ORDER BY recorded_at DESC LIMIT 1",
                    (entity, earliest, start)).fetchone())
                if baseline is not None:
                    previous = tuple(baseline)[1:]
            while start < end and self.active and self.generations.get(entity, 0) == generation:
                stop = min(start + DAY_MS, end)
                begin_dt = datetime.fromtimestamp((start - RECORDER_BOUNDARY_MS) / 1000, timezone.utc)
                end_dt = datetime.fromtimestamp(stop / 1000, timezone.utc)
                def read():
                    result = history.get_significant_states(self.hass, begin_dt, end_dt, [entity],
                        include_start_time_state=start > max(earliest, now_ms()-WINDOW), significant_changes_only=False,
                        minimal_response=False, no_attributes=False)
                    # A synthetic start state is stamped at begin_dt (start-1).
                    # It is comparison context only, never a new stored sample.
                    # Do not seed from before the current recording permission.
                    return recorder_changes(result.get(entity, []), start, stop, previous, max(earliest, now_ms()-WINDOW), point, mark_initial=True)
                if not self.recorder_available(recorder):
                    self.defer_backfill(entity, generation)
                    return
                rows, previous = await recorder.async_add_executor_job(read)
                if not self.recorder_available(recorder):
                    self.defer_backfill(entity, generation)
                    return
                async with self.lock:
                    if not self.active or entity not in self.devices or self.generations.get(entity, 0) != generation:
                        return
                    current = await self.run(lambda c: c.execute("SELECT consent_at FROM locaris_devices WHERE entity_id=?", (entity,)).fetchone())
                    if not self.active or entity not in self.devices or self.generations.get(entity, 0) != generation or current is None or current[0] != consent:
                        return
                    if not self.recorder_available(recorder):
                        self.defer_backfill(entity, generation)
                        return
                    count = await self.run(self.insert, entity, rows, "recorder", stop)
                    self.history_sync.changed(entity, count)
                start = stop
            if self.active and entity in self.devices and self.generations.get(entity, 0) == generation and recovery is not None:
                if end <= recovery:
                    self.defer_backfill(entity, generation)
                elif entity not in self.retry_import and self.recovery_from.get(entity) == recovery:
                    self.recovery_from.pop(entity, None)
            if self.active and entity in self.devices and self.generations.get(entity, 0) == generation and entity not in self.retry_import:
                self.history_sync.completed.add(entity)
                # Reuse only already-authorized historical rows; never query
                # Recorder separately for devices with recording disabled.
                current_payload = position(self.hass.states.get(entity))
                if current_payload is not None and self.live_clock.timestamp(entity, current_payload) is None:
                    try:
                        stamp = await self.run(last_recorded_change, entity, max(earliest, now_ms()-WINDOW), current_payload)
                        if (self.active and entity in self.devices and self.generations.get(entity, 0) == generation
                                and position(self.hass.states.get(entity)) == current_payload):
                            self.live_clock.restore(entity, current_payload, stamp)
                    except (sqlite3.Error, OSError):
                        self.warn("Live position timestamp recovery deferred (no coordinates logged)")
        except asyncio.CancelledError:
            raise
        except Exception:
            self.defer_backfill(entity, generation)
            self.warn("Location probe Recorder import failed (no coordinates logged)")

    def checkpoint(self):
        with closing(sqlite3.connect(self.path.as_uri()+"?mode=rw", uri=True, timeout=SQLITE_BUSY_TIMEOUT_S)) as con:
            busy, _, _ = con.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if busy:
                raise sqlite3.OperationalError("Location WAL checkpoint busy")

    async def checkpoint_safely(self):
        try:
            await self.hass.async_add_executor_job(self.checkpoint)
        except (sqlite3.Error, OSError):
            self.warn("Location WAL checkpoint deferred (no coordinates logged)")

    def checkpoint_if_needed(self):
        # A closed SQLite connection may already have checkpointed the WAL.
        # Keep explicit checkpoints for pause, removal and unload.
        try:
            if self.path.with_name(self.path.name + "-wal").stat().st_size > 0:
                self.checkpoint()
        except FileNotFoundError:
            pass

    async def cleanup(self):
        async with self.lock:
            if not self.active:
                return
            cutoff = now_ms() - WINDOW
            def prune(c):
                count = c.execute("DELETE FROM locaris_locations WHERE recorded_at < ?", (cutoff,)).rowcount
                c.execute("DELETE FROM locaris_address_cache WHERE created_at < ?", (cutoff,))
                return count
            self.history_sync.pruned(await self.run(prune))
            await self.hass.async_add_executor_job(self.checkpoint_if_needed)
            self.last_cleanup = now_ms()

    @staticmethod
    def cached_address(con, entity, lon, lat):
        # Use a bounding box for the index lookup, then an actual distance test.
        radius = 30
        dy = radius / 111000
        dx = min(180, dy / max(.001, abs(math.cos(math.radians(lat)))))
        rows = con.execute("""SELECT lon,lat,address,created_at FROM locaris_address_cache
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
        con.execute("INSERT INTO locaris_address_cache VALUES (?,?,?,?,?) ON CONFLICT(entity_id,lon,lat) DO UPDATE SET address=excluded.address,created_at=excluded.created_at", (entity,lon,lat,address,now_ms()))
        # Bound storage independently of the retention window.
        con.execute("DELETE FROM locaris_address_cache WHERE rowid IN (SELECT rowid FROM locaris_address_cache ORDER BY created_at DESC LIMIT -1 OFFSET 10000)")

    def history_meta(self, entity):
        generation = self.generations.get(entity, 0)
        return self.history_sync.meta(entity, generation, entity in self.devices,
            self.importing.get(entity) == generation,
            self.backfill_pending.get(entity) == generation, entity in self.retry_import)

    async def storage_stats(self):
        def read(con):
            cutoff = now_ms() - WINDOW
            # Foreign keys guarantee every location belongs to a stored device.
            location_count = con.execute("""SELECT COUNT(*) FROM locaris_locations WHERE recorded_at>=?""",
                (cutoff,)).fetchone()[0]
            address_count = con.execute(
                "SELECT COUNT(*) FROM locaris_address_cache WHERE created_at>=?",
                (cutoff,)).fetchone()[0]
            return location_count, address_count
        async with self.lock:
            if not self.active or not self.ready:
                raise RuntimeError("Storage not ready")
            location_count, address_count = await self.run(read)
            def database_size():
                total = 0
                for name in (self.path.name, self.path.name+"-wal", self.path.name+"-shm"):
                    try:
                        total += self.path.with_name(name).stat().st_size
                    except FileNotFoundError:
                        continue
                return total
            size = await self.hass.async_add_executor_job(database_size)
        return {"retention_days":HISTORY_RETENTION_DAYS,"database_bytes":size,"last_cleanup":self.last_cleanup,"location_count":location_count,"address_cache_count":address_count}

    async def stop(self):
        async with self.stop_lock:
            self.active = False
            self.ready = False
            for name in ("unsub", "timer", "discovery_listener"):
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
                    await self.checkpoint_safely()
                    self.initialized = False
            self.discovery_pending.clear()
            self.discovery_task = self.discovery_full_task = self.cleanup_task = None
            self.schedule = None
            self.importing.clear()
            self.retry_import.clear()
            self.recovery_from.clear()
            self.backfill_active.clear()
            self.backfill_pending.clear()
            self.live_clock.clear()
            self.last_valid.clear()
            self.warning_times.clear()
