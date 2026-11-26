"""Test real Store recovery independently of HA Recorder."""
import ast
import asyncio
import importlib.util
from pathlib import Path
import sqlite3
import time
from types import SimpleNamespace
import unittest

root=Path(__file__).resolve().parents[1]/"custom_components/locaris"
spec=importlib.util.spec_from_file_location("clock",root/"live_position_clock.py")
clock=importlib.util.module_from_spec(spec);spec.loader.exec_module(clock)
tree=ast.parse((root/"location_store.py").read_text())
cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=="Store")
methods=[n for n in cls.body if isinstance(n,(ast.AsyncFunctionDef,ast.FunctionDef)) and n.name in ("restore_live_time","schedule_clock_recovery")]
for method in methods:method.decorator_list=[]
fixture=ast.ClassDef(name="Store",bases=[],keywords=[],body=methods,decorator_list=[])
ns=dict(position=lambda x:x,now_ms=lambda:40000000,WINDOW=40000000,sqlite3=sqlite3,time=time,BACKFILL_RETRY_S=300,authorized_recorded_change=clock.authorized_recorded_change)
exec(compile(ast.fix_missing_locations(ast.Module(body=[fixture],type_ignores=[])),"<store>","exec"),ns)
Store=ns["Store"]

class RecoveryTest(unittest.IsolatedAsyncioTestCase):
    def setup_store(self):
        self.con=sqlite3.connect(":memory:");self.addCleanup(self.con.close)
        self.con.executescript("CREATE TABLE locaris_locations(entity_id,recorded_at,latitude,longitude,accuracy,source);"
                              "CREATE TABLE locaris_devices(entity_id,import_from);CREATE TABLE locaris_paused(entity_id);"
                              "INSERT INTO locaris_devices VALUES('a',0);"
                              "INSERT INTO locaris_locations VALUES('a',5425000,30.01,120.01,13.788,'recorder'),('a',32845000,30.02,120.02,48,'recorder_initial');")
        s=Store();s.active=s.ready=True;s.devices={"a"};s.generations={};s.live_clock=clock.LivePositionClock()
        s.clock_recovery_pending=set();s.clock_recovery_retry={};s.warn=lambda _:None
        self.payload=(30.02,120.02,48.);self.calls=0
        s.hass=SimpleNamespace(states=SimpleNamespace(get=lambda _:self.payload))
        s.live_clock.seed("a",self.payload)
        async def run(fn,*args):
            self.calls+=1;return fn(self.con,*args)
        s.run=run;s.spawn=asyncio.create_task
        return s
    async def test_restore_without_recorder_and_skip_known(self):
        s=self.setup_store()
        await s.restore_live_time("a",0)
        self.assertEqual(s.live_clock.timestamp("a",self.payload),32845000)
        await s.restore_live_time("a",0)
        self.assertEqual(self.calls,1)
        s.devices.clear()
        await s.restore_live_time("a",0)
        self.assertEqual(self.calls,1)
    async def test_generation_and_live_change_during_query(self):
        s=self.setup_store()
        run=s.run
        async def changed(fn,*args):
            result=await run(fn,*args)
            s.live_clock.observe("a",(39000000,*self.payload),(30.01,120.01,13.788))
            return result
        s.run=changed
        await s.restore_live_time("a",0)
        self.assertEqual(s.live_clock.timestamp("a",self.payload),39000000)
        s.live_clock.clear()
        async def invalidated(fn,*args):
            result=await run(fn,*args);s.generations["a"]=1;return result
        s.run=invalidated
        await s.restore_live_time("a",0)
        self.assertIsNone(s.live_clock.timestamp("a",self.payload))
    async def test_sql_failure_retries_and_coalesces(self):
        s=self.setup_store();run=s.run
        async def failed(*args):raise sqlite3.OperationalError("busy")
        s.run=failed
        await s.restore_live_time("a",0)
        self.assertIn("a",s.clock_recovery_retry)
        s.schedule_clock_recovery("a")
        self.assertFalse(s.clock_recovery_pending)
        s.clock_recovery_retry.clear();s.run=run
        s.schedule_clock_recovery("a");s.schedule_clock_recovery("a")
        await asyncio.sleep(0);await asyncio.sleep(0)
        self.assertEqual(self.calls,1)
        self.assertEqual(s.live_clock.timestamp("a",self.payload),32845000)
