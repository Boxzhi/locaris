import importlib.util
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location("live_position_clock", Path(__file__).resolve().parents[1] / "custom_components/locaris/live_position_clock.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
LivePositionClock = module.LivePositionClock
last_recorded_change = module.last_recorded_change

class LiveClockTest(unittest.TestCase):
    def test_unrelated_updates_and_accuracy(self):
        c = LivePositionClock()
        a, b = (1., 2., 10.), (1., 2., 20.)
        c.seed("a", a)
        self.assertIsNone(c.timestamp("a", a))
        c.observe("a", (100, *a), a)
        self.assertIsNone(c.timestamp("a", a))
        c.observe("a", (200, *b), a)
        c.observe("a", (300, *b), b)
        self.assertEqual(c.timestamp("a", b), 200)
        c.observe("a", None, b)
        c.observe("a", (400, *b), None)
        self.assertEqual(c.timestamp("a", b), 200)
        c.observe("a", (500, *a), None)
        self.assertEqual(c.timestamp("a", a), 500)
        self.assertIsNone(c.timestamp("a", b))

    def test_restore_and_remove(self):
        c = LivePositionClock()
        a, b = (1., 2., None), (3., 4., None)
        c.seed("a", a)
        c.restore("a", a, 100)
        self.assertEqual(c.timestamp("a", a), 100)
        c.observe("a", (200, *b), a)
        c.restore("a", a, 150)
        c.restore("a", b, 150)
        self.assertEqual(c.timestamp("a", b), 200)
        c.discard("a")
        self.assertIsNone(c.timestamp("a", b))

    def test_recovery_ignores_daily_duplicates_and_consent_boundary(self):
        with sqlite3.connect(":memory:") as con:
            con.execute("CREATE TABLE locaris_locations(entity_id,recorded_at,latitude,longitude,accuracy,source)")
            con.executemany("INSERT INTO locaris_locations VALUES(?,?,?,?,?,?)", [
                ("a",100,1.,2.,10.,"recorder"),
                ("a",200,1.,2.,None,"recorder"),
                ("a",300,1.,2.,None,"state_change_daily"),
                ("a",400,1.,2.,None,"recorder"),
                ("b",450,3.,4.,10.,"recorder"),
            ])
            self.assertEqual(last_recorded_change(con,"a",0,(1.,2.,None)),200)
            self.assertIsNone(last_recorded_change(con,"a",200,(1.,2.,None)))
            self.assertIsNone(last_recorded_change(con,"a",0,(1.,2.,10.)))
            self.assertIsNone(last_recorded_change(con,"b",0,(3.,4.,10.)))
            con.execute("INSERT INTO locaris_locations VALUES('a',500,3.,4.,10.,'state_change_daily')")
            self.assertIsNone(last_recorded_change(con,"a",0,(3.,4.,10.)))

    def test_unknown_never_becomes_unrelated_state_update(self):
        c = LivePositionClock()
        a = (1., 2., None)
        c.observe("a",(100,*a),None)
        c.observe("a",(200,*a),a)
        self.assertIsNone(c.timestamp("a",a))

    def test_first_confirmed_live_transition_can_restore_but_snapshot_cannot(self):
        with sqlite3.connect(":memory:") as con:
            con.execute("CREATE TABLE locaris_locations(entity_id,recorded_at,latitude,longitude,accuracy,source)")
            con.execute("INSERT INTO locaris_locations VALUES('a',100,1.,2.,10.,'state_change')")
            con.execute("INSERT INTO locaris_locations VALUES('b',100,1.,2.,10.,'enable_snapshot')")
            self.assertEqual(last_recorded_change(con,"a",0,(1.,2.,10.)),100)
            self.assertIsNone(last_recorded_change(con,"b",0,(1.,2.,10.)))
