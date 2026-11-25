"""Validate global runtime settings and keep independent monotonic deadlines."""
from .const import DISCOVERY_INTERVAL_S, BACKFILL_INTERVAL_S, CLEANUP_INTERVAL_S

DEFAULT_POLICY = {
    "discovery_minutes": DISCOVERY_INTERVAL_S // 60,
    "live_refresh_seconds": 30,
    "backfill_minutes": BACKFILL_INTERVAL_S // 60,
    "track_gap_minutes": 30,
}
POLICY_OPTIONS = {
    "discovery_minutes": (5, 10, 15, 30, 60),
    "live_refresh_seconds": (15, 30, 60, 120),
    "backfill_minutes": (30, 60, 120, 240),
    "track_gap_minutes": (10, 15, 30, 60),
}
POLICY_KEY = "runtime_policy_v1"

def validate_patch(patch):
    if type(patch) is not dict or not patch:
        raise ValueError("Invalid runtime policy")
    if any(key not in POLICY_OPTIONS or type(value) is not int or value not in POLICY_OPTIONS[key]
           for key, value in patch.items()):
        raise ValueError("Invalid runtime policy option")
    return dict(patch)

class Schedule:
    def __init__(self, policy, now):
        self.next_discovery = now + policy["discovery_minutes"] * 60
        self.next_backfill = now + policy["backfill_minutes"] * 60
        self.next_cleanup = now + CLEANUP_INTERVAL_S

    def update(self, old, new, now):
        if old["discovery_minutes"] != new["discovery_minutes"]:
            self.next_discovery = now + new["discovery_minutes"] * 60
        if old["backfill_minutes"] != new["backfill_minutes"]:
            self.next_backfill = now + new["backfill_minutes"] * 60

    def due(self, policy, now):
        discovery = now >= self.next_discovery
        backfill = now >= self.next_backfill
        cleanup = now >= self.next_cleanup
        if discovery:
            self.next_discovery = now + policy["discovery_minutes"] * 60
        if backfill:
            self.next_backfill = now + policy["backfill_minutes"] * 60
        if cleanup:
            self.next_cleanup = now + CLEANUP_INTERVAL_S
        return discovery, backfill, cleanup
