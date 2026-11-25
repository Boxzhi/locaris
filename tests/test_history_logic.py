"""Synthetic regression cases for location history logic (no HA required)."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("history_logic", Path(__file__).resolve().parents[1] / "custom_components/luxe_location_probe/history_logic.py")
logic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(logic)

class HistoryLogicTest(unittest.TestCase):
    def test_boundary_reference_never_written(self):
        rows, previous = logic.recorder_changes([(9, 1, 2, 3), (10, 1, 2, 3), (11, 2, 3, 4), (20, 3, 4, 5)], 10, 20, None, 0, lambda x: x)
        self.assertEqual(rows, [(11, 2, 3, 4)])
        self.assertEqual(previous, (2, 3, 4))

    def test_consent_cutoff(self):
        self.assertEqual(logic.recorder_changes([(9, 1, 2, 3), (10, 1, 2, 3)], 10, 20, None, 10, lambda x: x)[0], [(10, 1, 2, 3)])

    def test_repeat_and_return_across_windows(self):
        first, prev = logic.recorder_changes([(1, 1, 2, 3), (2, 1, 2, 3)], 0, 10, None, 0, lambda x: x)
        second, prev = logic.recorder_changes([(10, 1, 2, 3), None, (11, 2, 3, 4), (12, 1, 2, 3), (13, 1, 2, 4)], 10, 20, prev, 0, lambda x: x)
        self.assertEqual(first+second, [(1, 1, 2, 3), (11, 2, 3, 4), (12, 1, 2, 3), (13, 1, 2, 4)])

    def test_collapse_preserves_return_and_accuracy_change(self):
        a = dict(recorded_at=1, latitude=1, longitude=2, accuracy=3)
        b = dict(a, recorded_at=2)
        c = dict(a, recorded_at=3, latitude=2)
        d = dict(a, recorded_at=4)
        e = dict(a, recorded_at=5, accuracy=4)
        rows = [a,b,c,d,e]
        self.assertEqual(logic.collapse_history(rows), ([a,c,d,e],1,False))
        self.assertEqual(len(rows),5)

    def test_limit_after_collapse(self):
        a = dict(recorded_at=1, latitude=1, longitude=2, accuracy=None)
        b = dict(a, recorded_at=2, latitude=2)
        self.assertEqual(logic.collapse_history([a]*10001,1), ([a],10000,False))
        self.assertEqual(logic.collapse_history([a]*10001+[b],1), ([a],10000,True))

if __name__ == "__main__":
    unittest.main()
