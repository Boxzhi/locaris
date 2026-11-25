"""Pure history filtering; independent of Home Assistant and storage."""
def recorder_changes(states, start, stop, previous, earliest, point):
    """Return changed payloads in [start, stop), carrying valid comparison context."""
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
