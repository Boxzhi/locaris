"""Pure runtime policy and scheduling tests; no HA dependency."""
import importlib
from pathlib import Path
import sys
import types
import unittest

package = types.ModuleType("luxe_policy_test")
package.__path__ = [str(Path(__file__).resolve().parents[1] / "custom_components/locaris")]
sys.modules[package.__name__] = package
policy = importlib.import_module(package.__name__ + ".runtime_policy")
const = importlib.import_module(package.__name__ + ".const")

class RuntimePolicyTest(unittest.TestCase):
    def test_defaults_and_retention(self):
        self.assertEqual(policy.DEFAULT_POLICY, {
            "discovery_minutes": 10, "live_refresh_seconds": 30,
            "backfill_minutes": 60, "track_gap_minutes": 30,
        })
        self.assertEqual(const.WINDOW, 30 * 86400000)
        self.assertEqual(const.SCHEDULER_TICK_S, 60)
        self.assertEqual(const.BACKFILL_RETRY_S, 300)

    def test_allowlist(self):
        for key, values in policy.POLICY_OPTIONS.items():
            for value in values:
                self.assertEqual(policy.validate_patch({key: value}), {key: value})
        for invalid in ({}, {"retention_days": 60}, {"live_refresh_seconds": True},
                        {"live_refresh_seconds": "30"}, {"discovery_minutes": 1},
                        {"backfill_minutes": 5}, {"track_gap_minutes": 30.0},
                        {"discovery_minutes": 10, "retention_days": 30}, []):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                policy.validate_patch(invalid)

    def test_independent_deadlines(self):
        p = policy.DEFAULT_POLICY
        s = policy.Schedule(p, 0)
        self.assertEqual(s.due(p, 599), (False, False, False))
        self.assertEqual(s.due(p, 600), (True, False, False))
        self.assertEqual(s.due(p, 600), (False, False, False))
        self.assertEqual(s.due(p, 3600), (True, True, False))
        self.assertEqual(s.due(p, 21600), (True, True, True))
        self.assertEqual(s.due(p, 21601), (False, False, False))

    def test_update_only_changes_affected_deadline(self):
        p = policy.DEFAULT_POLICY
        s = policy.Schedule(p, 0)
        new = {**p, "discovery_minutes": 60, "live_refresh_seconds": 120}
        s.update(p, new, 90)
        self.assertEqual(s.next_discovery, 3690)
        self.assertEqual(s.next_backfill, 3600)
        self.assertEqual(s.next_cleanup, 21600)
        new2 = {**new, "backfill_minutes": 240}
        s.update(new, new2, 120)
        self.assertEqual(s.next_discovery, 3690)
        self.assertEqual(s.next_backfill, 14520)
        self.assertEqual(s.next_cleanup, 21600)

    def test_cleanup_failure_retry_is_independent(self):
        p = policy.DEFAULT_POLICY
        s = policy.Schedule(p, 0)
        s.due(p, 21600)
        discovery, backfill = s.next_discovery, s.next_backfill
        s.defer_cleanup(21605)
        self.assertEqual(s.next_cleanup, 21905)
        self.assertEqual(s.next_discovery, discovery)
        self.assertEqual(s.next_backfill, backfill)
        self.assertEqual(s.due(p, 21904), (False, False, False))
        self.assertEqual(s.due(p, 21905), (False, False, True))
