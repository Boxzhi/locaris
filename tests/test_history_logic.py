"""Synthetic regression cases for location history logic (no HA required)."""
import importlib.util
from pathlib import Path
import unittest
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

spec = importlib.util.spec_from_file_location("history_logic", Path(__file__).resolve().parents[1] / "custom_components/locaris/history_logic.py")
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

    def test_cross_day_unchanged_not_written(self):
        tz=ZoneInfo("Asia/Shanghai")
        start=int(datetime(2026,11,25,tzinfo=tz).timestamp()*1000)
        prev=(1,2,3)
        rows, previous=logic.recorder_changes(
            [(start-1,*prev),(start+100,*prev),(start+200,*prev),(start+300,1,2,4)],
            start,start+1000,prev,0,lambda x:x)
        self.assertEqual(rows,[(start+300,1,2,4)])
        rows, _=logic.recorder_changes([(start+86400000+500,1,2,4)],start+86400000,start+86400000+1000,previous,0,lambda x:x)
        self.assertEqual(rows,[])

    def test_dst_day_bounds(self):
        tz=ZoneInfo("America/New_York")
        for month,day,hours in [(3,8,23),(11,1,25)]:
            stamp=int(datetime(2026,month,day,12,tzinfo=tz).timestamp()*1000)
            lo,hi=logic.day_bounds(stamp,tz)
            self.assertEqual(hi-lo,hours*3600000)

    def test_one_time_cleanup_respects_current_consent_and_real_transitions(self):
        con=sqlite3.connect(":memory:")
        self.addCleanup(con.close)
        con.executescript("CREATE TABLE locaris_metadata(key TEXT PRIMARY KEY,value TEXT);"
                          "CREATE TABLE locaris_devices(entity_id TEXT PRIMARY KEY,import_from INTEGER,history_cursor INTEGER);"
                          "CREATE TABLE locaris_locations(entity_id TEXT,recorded_at INTEGER,latitude REAL,longitude REAL,accuracy REAL,source TEXT);"
                          "INSERT INTO locaris_devices VALUES ('a',15,900),('b',0,900);"
                          "INSERT INTO locaris_locations VALUES ('a',10,1,2,3,'recorder'),('a',20,1,2,3,'recorder'),('a',30,1,2,3,'state_change_daily'),('a',40,1,2,4,'state_change'),('a',50,1,2,4,'recorder'),('a',60,1,2,3,'state_change'),('a',70,1,2,3,'state_change'),('b',20,1,2,3,'recorder'),('b',30,1,2,3,'recorder');")
        self.assertEqual(logic.migrate_change_only(con,['a'],0),2)
        self.assertEqual(con.execute("SELECT recorded_at FROM locaris_locations WHERE entity_id='a' ORDER BY recorded_at").fetchall(),[(10,),(20,),(40,),(60,),(70,)])
        self.assertEqual(con.execute("SELECT count(*) FROM locaris_locations WHERE entity_id='b'").fetchone()[0],2)
        self.assertEqual(logic.migrate_change_only(con,['a'],0),0)
        self.assertEqual(con.execute("SELECT history_cursor FROM locaris_devices WHERE entity_id='a'").fetchone()[0],900)

    def test_reference_not_counted_and_no_cross_consent_or_retention(self):
        con=sqlite3.connect(":memory:")
        self.addCleanup(con.close)
        con.row_factory=sqlite3.Row
        con.executescript("CREATE TABLE locaris_devices(entity_id TEXT PRIMARY KEY,import_from INTEGER);"
                          "CREATE TABLE locaris_paused(entity_id TEXT PRIMARY KEY);"
                          "CREATE TABLE locaris_locations(entity_id TEXT,recorded_at INTEGER,latitude REAL,longitude REAL,accuracy REAL,source TEXT);"
                          "INSERT INTO locaris_devices VALUES ('a',15);"
                          "INSERT INTO locaris_locations VALUES ('a',10,1,2,3,'recorder'),('a',20,1,2,4,'recorder'),('a',40,1,2,5,'state_change');")
        self.assertEqual(logic.history_reference(con,'a',30,0)['recorded_at'],20)
        self.assertIsNone(logic.history_reference(con,'a',20,0))
        self.assertIsNone(logic.history_reference(con,'a',30,21))
        con.execute("INSERT INTO locaris_paused VALUES ('a')")
        self.assertIsNone(logic.history_reference(con,'a',30,0))
        self.assertEqual(con.execute("SELECT count(*) FROM locaris_locations").fetchone()[0],3)

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
