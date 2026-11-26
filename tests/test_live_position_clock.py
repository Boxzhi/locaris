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
            self.assertEqual(last_recorded_change(con,"a",0,(3.,4.,10.)),500)

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

    def test_two_distinct_points_restore_even_if_second_has_initial_source(self):
        # Synthetic locations, same two-record/accuracy pattern as reported.
        with sqlite3.connect(":memory:") as con:
            con.execute("CREATE TABLE locaris_locations(entity_id,recorded_at,latitude,longitude,accuracy,source)")
            old=(30.01,120.01,13.788)
            current=(30.02,120.02,48.)
            for source in ("recorder","recorder_initial","state_change_initial","state_change_daily","state_change"):
                con.execute("DELETE FROM locaris_locations")
                con.executemany("INSERT INTO locaris_locations VALUES(?,?,?,?,?,?)",[
                    ("a",5425000,*old,"recorder"),
                    ("a",32845000,*current,source),
                    ("a",38869000,*current,"state_change_daily"),
                ])
                self.assertEqual(last_recorded_change(con,"a",0,current),32845000,source)
                self.assertIsNone(last_recorded_change(con,"a",32845000,current) if source!="state_change" else None)
                self.assertIsNone(last_recorded_change(con,"a",0,old))
                self.assertIsNone(last_recorded_change(con,"a",0,(*current[:2],49.)))
    def test_enable_snapshot_never_becomes_change_by_itself(self):
        with sqlite3.connect(":memory:") as con:
            con.execute("CREATE TABLE locaris_locations(entity_id,recorded_at,latitude,longitude,accuracy,source)")
            con.executemany("INSERT INTO locaris_locations VALUES(?,?,?,?,?,?)",[
                ("a",10,1.,2.,10.,"recorder"),
                ("a",20,3.,4.,48.,"enable_snapshot"),
                ("a",30,3.,4.,48.,"recorder_initial"),
            ])
            self.assertIsNone(last_recorded_change(con,"a",0,(3.,4.,48.)))
            con.execute("INSERT INTO locaris_locations VALUES('a',40,3.,4.,48.,'state_change')")
            self.assertEqual(last_recorded_change(con,"a",0,(3.,4.,48.)),40)
    def test_authorized_query_does_not_cross_pause_or_import_boundary(self):
        with sqlite3.connect(":memory:") as con:
            con.executescript("CREATE TABLE locaris_locations(entity_id,recorded_at,latitude,longitude,accuracy,source);"
                              "CREATE TABLE locaris_devices(entity_id,import_from);"
                              "CREATE TABLE locaris_paused(entity_id);"
                              "INSERT INTO locaris_devices VALUES('a',0);"
                              "INSERT INTO locaris_locations VALUES('a',10,1,2,10,'recorder'),('a',20,3,4,48,'recorder_initial');")
            restore=module.authorized_recorded_change
            self.assertEqual(restore(con,"a",0,(3.,4.,48.)),20)
            self.assertIsNone(restore(con,"a",11,(3.,4.,48.)))
            con.execute("UPDATE locaris_devices SET import_from=11")
            self.assertIsNone(restore(con,"a",0,(3.,4.,48.)))
            con.execute("UPDATE locaris_devices SET import_from=0")
            con.execute("INSERT INTO locaris_paused VALUES('a')")
            self.assertIsNone(restore(con,"a",0,(3.,4.,48.)))
