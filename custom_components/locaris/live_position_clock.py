"""Last observed GPS payload change, separate from HA state update and history."""
class LivePositionClock:
    def __init__(self):
        self.values = {}

    def seed(self, entity, payload):
        if payload is not None:
            self.values.setdefault(entity, (payload, None))

    def observe(self, entity, sample, old_payload):
        if sample is None:
            return
        stamp, payload = sample[0], tuple(sample[1:])
        cached = self.values.get(entity)
        if cached is not None and cached[0] == payload:
            # A real transition in old/new can still reveal a return to
            # the cached coordinates after an unavailable or missed event.
            if old_payload is not None and old_payload != payload:
                self.values[entity] = (payload, stamp)
            return
        previous = old_payload if old_payload is not None else (cached[0] if cached else None)
        changed_at = stamp if previous is not None and previous != payload else None
        self.values[entity] = (payload, changed_at)

    def timestamp(self, entity, payload):
        cached = self.values.get(entity)
        return cached[1] if cached is not None and cached[0] == payload else None

    def restore(self, entity, payload, stamp):
        if stamp is None or payload is None:
            return
        cached = self.values.get(entity)
        # Never replace a verified live transition, or restore into a
        # different live payload while the asynchronous query was running.
        if cached is None or (cached[0] == payload and cached[1] is None):
            self.values[entity] = (payload, stamp)

    def discard(self, entity):
        self.values.pop(entity, None)

    def clear(self):
        self.values.clear()


def last_recorded_change(con, entity, earliest, payload):
    """Recover the start of the latest matching run, not daily anchors.
    Never infer a transition from the first available sample alone.
    """
    latest = con.execute(
        "SELECT recorded_at,latitude,longitude,accuracy FROM locaris_locations "
        "WHERE entity_id=? AND recorded_at>=? ORDER BY recorded_at DESC LIMIT 1",
        (entity, earliest),
    ).fetchone()
    if latest is None or tuple(latest)[1:] != payload:
        return None
    prior = con.execute(
        "SELECT recorded_at FROM locaris_locations WHERE entity_id=? AND recorded_at>=? "
        "AND (latitude IS NOT ? OR longitude IS NOT ? OR accuracy IS NOT ?) "
        "ORDER BY recorded_at DESC LIMIT 1",
        (entity, earliest, *payload),
    ).fetchone()
    if prior is None:
        return None
    first = con.execute(
        "SELECT recorded_at,source FROM locaris_locations WHERE entity_id=? AND recorded_at>? "
        "ORDER BY recorded_at ASC LIMIT 1",
        (entity, prior[0]),
    ).fetchone()
    return first[0] if first is not None and first[1] not in ("state_change_daily", "state_change_initial") else None
