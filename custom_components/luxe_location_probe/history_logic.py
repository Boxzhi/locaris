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
