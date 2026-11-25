"""Pure history sync revision/status tests."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("locaris_history_sync_test",
    Path(__file__).resolve().parents[1] / "custom_components/locaris/history_sync.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class HistorySyncTest(unittest.TestCase):
    def setUp(self):
        self.sync = module.HistorySync()

    def meta(self, entity="device_tracker.a", generation=0, enabled=True,
             importing=False, queued=False, retry=False):
        return self.sync.meta(entity, generation, enabled, importing, queued, retry)

    def test_status_priority_and_completion(self):
        for flags, status in [
            ({"enabled":False,"retry":True},"disabled"),
            ({"retry":True,"importing":True},"retry"),
            ({"queued":True},"queued"),
            ({"importing":True},"importing"),
            ({}, "ready"),
        ]:
            self.assertEqual(self.meta(**flags)["sync_status"], status)
        self.sync.completed.add("device_tracker.a")
        self.assertEqual(self.meta(importing=True)["sync_status"], "syncing")
        self.sync.invalidate("device_tracker.a")
        self.assertEqual(self.meta(importing=True)["sync_status"], "importing")

    def test_duplicate_inserts_and_status_do_not_change_revision(self):
        old = self.meta()["revision"]
        self.sync.changed("device_tracker.a", 0)
        self.assertEqual(old, self.meta(importing=True)["revision"])
        self.assertEqual(old, self.meta(retry=True)["revision"])

    def test_only_changed_device_revision_changes(self):
        a, b = self.meta()["revision"], self.meta("device_tracker.b")["revision"]
        self.sync.changed("device_tracker.a", 3)
        self.assertNotEqual(a, self.meta()["revision"])
        self.assertEqual(b, self.meta("device_tracker.b")["revision"])

    def test_removal_generation_and_cleanup(self):
        a = self.meta()["revision"]
        self.sync.invalidate("device_tracker.a")
        self.assertNotEqual(a, self.meta()["revision"])
        self.assertNotEqual(self.meta()["revision"], self.meta(generation=1)["revision"])
        a, b = self.meta()["revision"], self.meta("device_tracker.b")["revision"]
        self.sync.pruned(0)
        self.assertEqual(a, self.meta()["revision"])
        self.sync.pruned(2)
        self.assertNotEqual(a, self.meta()["revision"])
        self.assertNotEqual(b, self.meta("device_tracker.b")["revision"])

    def test_restart_changes_session(self):
        other = module.HistorySync()
        self.assertNotEqual(self.meta()["revision"], other.meta("device_tracker.a", 0, True, False, False, False)["revision"])
