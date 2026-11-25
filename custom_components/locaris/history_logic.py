"""Pure history filtering; independent of Home Assistant and storage."""
from datetime import datetime, timedelta

def day_bounds(stamp, tz):
    """HA-local calendar day, including DST-short/long days."""
    local = datetime.fromtimestamp(stamp / 1000, tz)
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return int(start.timestamp()*1000), int(end.timestamp()*1000)

def recorder_changes(states, start, stop, previous, earliest, point):
    """Continuous comparison helper."""
    rows, prev, _ = recorder_daily_changes(states, start, stop, previous, earliest, point)
    return rows, prev

def recorder_daily_changes(states, start, stop, previous, earliest, point,
                           previous_day=None, tz=None):
    """Retain first real eligible sample per HA-local day and later changes.
    Synthetic boundary states provide payload context only, never a daily anchor.
    """
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
        day = day_bounds(stamp, tz)[0] if tz is not None else None
        if prev is None or payload != prev or (tz is not None and day != previous_day):
            rows.append(p)
        prev = payload
        previous_day = day
    return rows, prev, previous_day

def prepare_daily_replay(con, enabled, cutoff):
    """Revisit existing authorized history once, without resetting consent."""
    key = "daily_first_v1"
    if con.execute("SELECT 1 FROM locaris_metadata WHERE key=?", (key,)).fetchone():
        return False
    con.executemany(
        "UPDATE locaris_devices SET history_cursor=MAX(import_from,?) WHERE entity_id=?",
        [(cutoff, entity) for entity in enabled],
    )
    con.execute("INSERT INTO locaris_metadata VALUES (?,?)", (key, "1"))
    return True

def prune_provisional_anchors(con, entity, days, cutoff):
    """Remove only redundant live daily anchors after earlier Recorder samples arrive."""
    for start, end in days:
        start = max(start, cutoff)
        rows = con.execute(
            "SELECT recorded_at,latitude,longitude,accuracy FROM locaris_locations "
            "WHERE entity_id=? AND recorded_at>=? AND recorded_at<? AND source='state_change_daily' "
            "ORDER BY recorded_at", (entity, start, end)).fetchall()
        for row in rows:
            prior = con.execute(
                "SELECT latitude,longitude,accuracy FROM locaris_locations "
                "WHERE entity_id=? AND recorded_at>=? AND recorded_at<? ORDER BY recorded_at DESC LIMIT 1",
                (entity, start, row[0])).fetchone()
            if prior is not None and tuple(prior) == tuple(row)[1:]:
                con.execute("DELETE FROM locaris_locations WHERE entity_id=? AND recorded_at=? AND source='state_change_daily'",
                            (entity, row[0]))

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
