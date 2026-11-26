"""Exercise real Store methods without a running HA instance."""
import ast
import asyncio
import importlib.util
from pathlib import Path
import sqlite3
from types import SimpleNamespace
import unittest

root = Path(__file__).resolve().parents[1] / "custom_components/locaris"
spec = importlib.util.spec_from_file_location("history_logic", root / "history_logic.py")
logic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(logic)
source = ast.parse((root / "location_store.py").read_text())
cls = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == "Store")
methods = [n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in ("changed", "insert", "enable")]
for method in methods:
    method.decorator_list = [d for d in method.decorator_list if isinstance(d, ast.Name) and d.id == "staticmethod"]
fixture = ast.ClassDef(name="Store", bases=[], keywords=[], body=methods, decorator_list=[])
ns = dict(now_ms=lambda: 1000, WINDOW=1000, point=lambda x:x, position=lambda x:x[1:] if isinstance(x,tuple) else getattr(x,"payload",None),
          compact_repeated=logic.compact_repeated)
exec(compile(ast.fix_missing_locations(ast.Module(body=[fixture], type_ignores=[])), "<store>", "exec"), ns)
Store = ns["Store"]

class ChangeOnlyStorageTest(unittest.TestCase):
    def test_live_payload_only_no_daily_anchor(self):
        store = Store()
        a = (1.,2.,10.)
        b = (1.,2.,20.)
        c = (3.,4.,20.)
        store.active = store.ready = True
        store.devices = {"a"}
        store.last_valid = {"a": a}
        store.generations = {}
        store.pending_writes = 0
        writes = []
        store.write = lambda *args: writes.append(args)
        store.spawn = lambda _: SimpleNamespace(add_done_callback=lambda cb: None)
        store.write_finished = lambda _: None
        def event(new, old):
            store.changed(SimpleNamespace(data=dict(entity_id="a",new_state=new,old_state=old)))
        event((10,*a),(9,*a))
        event((86400000,*a),(10,*a))
        event(None,(86400000,*a))
        event((86400001,*a),None)
        event((86400002,*b),(86400001,*a))
        event((86400003,*c),(86400002,*b))
        event((86400004,*a),(86400003,*c))
        self.assertEqual([x[1][0] for x in writes],[86400002,86400003,86400004])
        self.assertTrue(all(not x[3] for x in writes))
        store.last_valid.clear()
        event((86400005,*a),(86400004,*a))
        self.assertTrue(writes[-1][3])

    def test_insert_provisional_dedup_and_keep_return(self):
        con=sqlite3.connect(":memory:")
        self.addCleanup(con.close)
        con.row_factory=sqlite3.Row
        con.executescript("CREATE TABLE locaris_devices(entity_id TEXT PRIMARY KEY,import_from INTEGER,history_cursor INTEGER);"
                          "CREATE TABLE locaris_locations(entity_id TEXT,recorded_at INTEGER,latitude REAL,longitude REAL,accuracy REAL,source TEXT,PRIMARY KEY(entity_id,recorded_at));"
                          "INSERT INTO locaris_devices VALUES ('a',100,100);")
        a=(1.,2.,10.)
        b=(1.,2.,20.)
        self.assertEqual(Store.insert(con,"a",[(200,*a)],"state_change_initial"),1)
        self.assertEqual(Store.insert(con,"a",[(300,*a)],"state_change_initial"),0)
        self.assertEqual(Store.insert(con,"a",[(400,*b),(500,*a)],"state_change"),2)
        Store.insert(con,"a",[(150,*a)],"recorder",600)
        self.assertEqual([tuple(r) for r in con.execute("SELECT recorded_at,accuracy FROM locaris_locations ORDER BY recorded_at")],[(150,10.),(400,20.),(500,10.)])
        self.assertEqual(con.execute("SELECT history_cursor FROM locaris_devices").fetchone()[0],600)
        self.assertEqual(Store.insert(con,"a",[(99,*a)],"state_change"),0)

    def test_explicit_enable_snapshot_is_provisional(self):
        con=sqlite3.connect(":memory:")
        self.addCleanup(con.close)
        con.row_factory=sqlite3.Row
        con.executescript("CREATE TABLE locaris_devices(entity_id TEXT PRIMARY KEY,import_from INTEGER,history_cursor INTEGER);"
                          "CREATE TABLE locaris_locations(entity_id TEXT,recorded_at INTEGER,latitude REAL,longitude REAL,accuracy REAL,source TEXT,PRIMARY KEY(entity_id,recorded_at));"
                          "INSERT INTO locaris_devices VALUES ('a',100,100);")
        a=(1.,2.,10.)
        self.assertEqual(Store.insert(con,"a",[(300,*a)],"enable_snapshot"),1)
        Store.insert(con,"a",[(200,*a)],"recorder",400)
        self.assertEqual([tuple(r) for r in con.execute("SELECT recorded_at,source FROM locaris_locations")],[(200,"recorder")])

    def test_recorder_initial_duplicate_after_snapshot_not_written(self):
        con=sqlite3.connect(":memory:")
        self.addCleanup(con.close)
        con.row_factory=sqlite3.Row
        con.executescript("CREATE TABLE locaris_devices(entity_id TEXT PRIMARY KEY,import_from INTEGER,history_cursor INTEGER);"
                          "CREATE TABLE locaris_locations(entity_id TEXT,recorded_at INTEGER,latitude REAL,longitude REAL,accuracy REAL,source TEXT,PRIMARY KEY(entity_id,recorded_at));"
                          "INSERT INTO locaris_devices VALUES ('a',100,100);")
        a=(1.,2.,10.)
        b=(1.,2.,20.)
        Store.insert(con,"a",[(200,*a)],"enable_snapshot")
        Store.insert(con,"a",[(250,*a,"recorder_initial"),(300,*b,"recorder"),(350,*a,"recorder")],"recorder",400)
        self.assertEqual([tuple(r) for r in con.execute("SELECT recorded_at,source FROM locaris_locations ORDER BY recorded_at")],
                         [(200,"enable_snapshot"),(300,"recorder"),(350,"recorder")])

class EnableTest(unittest.IsolatedAsyncioTestCase):
    async def test_enable_has_one_snapshot_and_preserves_previous_history(self):
        con=sqlite3.connect(":memory:")
        self.addCleanup(con.close)
        con.row_factory=sqlite3.Row
        con.executescript("CREATE TABLE locaris_devices(entity_id TEXT PRIMARY KEY,consent_at INTEGER,import_from INTEGER,history_cursor INTEGER);"
                          "CREATE TABLE locaris_paused(entity_id TEXT PRIMARY KEY);"
                          "CREATE TABLE locaris_locations(entity_id TEXT,recorded_at INTEGER,latitude REAL,longitude REAL,accuracy REAL,source TEXT,PRIMARY KEY(entity_id,recorded_at));")
        entity="device_tracker.a"
        store=Store()
        store.active=store.ready=True
        store.devices=set()
        store.managed={entity}
        store.lock=asyncio.Lock()
        store.last_valid={}
        store.generations={}
        store.hass=SimpleNamespace(states=SimpleNamespace(get=lambda _:SimpleNamespace(attributes={"source_type":"gps"},payload=(1.,2.,10.))))
        store.invalidate=lambda _:None
        store.listen=lambda:None
        store.history_sync=SimpleNamespace(changed=lambda *args:None)
        store.schedule_backfill=lambda _:None
        async def run(fn,*args):
            with con:return fn(con,*args)
        store.run=run
        await store.enable(entity,False)
        await store.enable(entity,False)
        self.assertEqual([tuple(r) for r in con.execute("SELECT recorded_at,source FROM locaris_locations")],[(1000,"enable_snapshot")])
        self.assertEqual(con.execute("SELECT import_from FROM locaris_devices").fetchone()[0],1000)
        self.assertEqual(store.last_valid[entity],(1.,2.,10.))
