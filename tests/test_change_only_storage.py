"""Exercise real Store methods without a running HA instance."""
import ast
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
methods = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in ("changed", "insert")]
for method in methods:
    method.decorator_list = [d for d in method.decorator_list if isinstance(d, ast.Name) and d.id == "staticmethod"]
fixture = ast.ClassDef(name="Store", bases=[], keywords=[], body=methods, decorator_list=[])
ns = dict(now_ms=lambda: 1000, WINDOW=1000, point=lambda x:x, position=lambda x:x[1:] if x else None,
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
