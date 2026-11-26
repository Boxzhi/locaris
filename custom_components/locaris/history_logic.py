"""Pure history filtering; independent of Home Assistant and storage."""
from datetime import datetime, timedelta

def day_bounds(stamp, tz):
    """HA-local calendar day, including DST-short/long days."""
    local = datetime.fromtimestamp(stamp / 1000, tz)
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return int(start.timestamp()*1000), int(end.timestamp()*1000)

def recorder_changes(states, start, stop, previous, earliest, point):
    """Keep one initial real sample and subsequent payload changes, across days."""
    rows = []
    prev = previous
    for state in states:
        p = point(state)
        if p is None:
            continue
        stamp, payload = p[0], p[1:]
        if stamp < start:
            if earliest <= stamp:
                prev = payload
            continue
        if stamp >= stop:
            continue
        if prev is None or payload != prev:
            rows.append(p)
        prev = payload
    return rows, prev

def compact_repeated(con, entity, cutoff, *, legacy=False, affected_from=None):
    """Remove redundant provisional/legacy anchors, never confirmed live changes.
    Only compare within one currently authorized recording interval.
    """
    sources = {"state_change_initial", "state_change_daily", "enable_snapshot"}
    if not legacy:
        # Only provisional successors can become redundant after an insertion.
        # The composite primary key handles each predecessor lookup efficiently.
        candidates = con.execute(
            "SELECT recorded_at,latitude,longitude,accuracy FROM locaris_locations "
            "WHERE entity_id=? AND recorded_at>=? AND source IN ('state_change_initial','state_change_daily','enable_snapshot') ORDER BY recorded_at",
            (entity, max(cutoff, affected_from if affected_from is not None else cutoff))).fetchall()
        removed = 0
        for row in candidates:
            prior = con.execute(
                "SELECT latitude,longitude,accuracy FROM locaris_locations WHERE entity_id=? "
                "AND recorded_at>=? AND recorded_at<? ORDER BY recorded_at DESC LIMIT 1",
                (entity, cutoff, row[0])).fetchone()
            if prior is not None and tuple(prior) == tuple(row)[1:]:
                removed += con.execute("DELETE FROM locaris_locations WHERE entity_id=? AND recorded_at=?", (entity, row[0])).rowcount
        return removed
    sources.add("recorder")
    rows = con.execute(
        "SELECT recorded_at,latitude,longitude,accuracy,source FROM locaris_locations "
        "WHERE entity_id=? AND recorded_at>=? ORDER BY recorded_at", (entity, cutoff))
    previous = None
    redundant = []
    for row in rows:
        payload = tuple(row)[1:4]
        if previous == payload and row[4] in sources:
            redundant.append((entity, row[0]))
        else:
            previous = payload
    con.executemany("DELETE FROM locaris_locations WHERE entity_id=? AND recorded_at=?", redundant)
    return len(redundant)

def migrate_change_only(con, enabled, cutoff):
    """One-time conservative cleanup without changing consent or history cursor."""
    key = "change_only_v1"
    if con.execute("SELECT 1 FROM locaris_metadata WHERE key=?", (key,)).fetchone():
        return 0
    count = 0
    for entity in enabled:
        row = con.execute("SELECT import_from FROM locaris_devices WHERE entity_id=?", (entity,)).fetchone()
        if row is not None:
            count += compact_repeated(con, entity, max(cutoff, row[0]), legacy=True)
    con.execute("INSERT INTO locaris_metadata VALUES (?,?)", (key, "1"))
    return count

def history_reference(con, entity, start, cutoff):
    """Use a stored point before the day, inside current consent and retention."""
    row = con.execute("SELECT import_from FROM locaris_devices WHERE entity_id=? "
                      "AND entity_id NOT IN (SELECT entity_id FROM locaris_paused)", (entity,)).fetchone()
    if row is None:
        return None
    previous = con.execute(
        "SELECT recorded_at,latitude,longitude,accuracy,source FROM locaris_locations "
        "WHERE entity_id=? AND recorded_at>=? AND recorded_at<? ORDER BY recorded_at DESC LIMIT 1",
        (entity, max(cutoff, row[0]), start)).fetchone()
    return dict(previous) if previous is not None else None

def collapse_history(rows, limit=10000):
    """Collapse only consecutive identical payloads; retain first in each query."""
    points = []
    hidden = 0
    previous = None
    for row in rows:
        payload = (row["latitude"], row["longitude"], row["accuracy"])
        if previous is not None and payload == previous:
            hidden += 1
            continue
        if len(points) >= limit:
            return points, hidden, True
        points.append(dict(row))
        previous = payload
    return points, hidden, False
