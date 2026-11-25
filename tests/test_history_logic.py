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

    def test_daily_anchors_and_synthetic_boundary(self):
        tz=ZoneInfo("Asia/Shanghai")
        start=int(datetime(2026,11,25,tzinfo=tz).timestamp()*1000)
        prev=(1,2,3)
        rows, previous, day=logic.recorder_daily_changes(
            [(start-1,*prev),(start+100,*prev),(start+200,*prev),(start+300,1,2,4)],
            start,start+1000,prev,0,lambda x:x,start-86400000,tz)
        self.assertEqual(rows,[(start+100,*prev),(start+300,1,2,4)])
        self.assertEqual(day,start)
        rows, _, _=logic.recorder_daily_changes([(start+1000,1,2,4)],start+1000,start+2000,
            previous,0,lambda x:x,day,tz)
        self.assertEqual(rows,[])
        rows, _, _=logic.recorder_daily_changes([(start+86400000-1,1,2,4),(start+86400000+500,1,2,4)],
            start+86400000,start+86400000+1000,previous,0,lambda x:x,day,tz)
        self.assertEqual(rows,[(start+86400000+500,1,2,4)])

    def test_dst_day_bounds(self):
        tz=ZoneInfo("America/New_York")
        for month,day,hours in [(3,8,23),(11,1,25)]:
            stamp=int(datetime(2026,month,day,12,tzinfo=tz).timestamp()*1000)
            lo,hi=logic.day_bounds(stamp,tz)
            self.assertEqual(hi-lo,hours*3600000)

    def test_one_time_replay_respects_consent_and_disabled_devices(self):
        con=sqlite3.connect(":memory:")
        self.addCleanup(con.close)
        con.executescript("CREATE TABLE locaris_metadata(key TEXT PRIMARY KEY,value TEXT);"
                          "CREATE TABLE locaris_devices(entity_id TEXT PRIMARY KEY,import_from INTEGER,history_cursor INTEGER);"
                          "INSERT INTO locaris_devices VALUES ('a',100,900),('b',600,900),('c',100,900);")
        self.assertTrue(logic.prepare_daily_replay(con,['a','b'],500))
        self.assertEqual(con.execute("SELECT history_cursor FROM locaris_devices ORDER BY entity_id").fetchall(),[(500,),(600,),(900,)])
        con.execute("UPDATE locaris_devices SET history_cursor=950")
        self.assertFalse(logic.prepare_daily_replay(con,['a','b'],500))
        self.assertEqual(con.execute("SELECT history_cursor FROM locaris_devices ORDER BY entity_id").fetchall(),[(950,),(950,),(950,)])

    def test_remove_only_redundant_provisional_anchors(self):
        con=sqlite3.connect(":memory:")
        self.addCleanup(con.close)
        con.executescript("CREATE TABLE locaris_locations(entity_id TEXT,recorded_at INTEGER,latitude REAL,longitude REAL,accuracy REAL,source TEXT);"
                          "INSERT INTO locaris_locations VALUES ('a',10,1,2,3,'recorder'),('a',20,1,2,3,'state_change_daily'),('a',30,1,2,4,'state_change'),('a',40,1,2,4,'state_change_daily'),('a',50,1,2,5,'state_change_daily'),('b',20,1,2,3,'state_change_daily');")
        logic.prune_provisional_anchors(con,'a',[(0,100)],0)
        self.assertEqual(con.execute("SELECT recorded_at FROM locaris_locations WHERE entity_id='a' ORDER BY recorded_at").fetchall(),[(10,),(30,),(50,)])
        self.assertEqual(con.execute("SELECT count(*) FROM locaris_locations WHERE entity_id='b'").fetchone()[0],1)

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
