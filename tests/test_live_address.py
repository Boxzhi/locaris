"""Regression tests of the real address resolver using isolated HA fakes."""
import ast
import asyncio
import json
from pathlib import Path
import time
from types import SimpleNamespace
import unittest

source = Path(__file__).resolve().parents[1] / "custom_components/locaris/__init__.py"
node = next(n for n in ast.parse(source.read_text()).body
            if isinstance(n, ast.AsyncFunctionDef) and n.name == "resolve_address")

async def admin(hass, connection):
    return connection.user.is_admin

async def read_limited(content, size):
    return content

class Response:
    status = 200
    content = b'{"status":"1","regeocode":{"formatted_address":"Current address"}}'
    def __init__(self, on_request):
        self.on_request = on_request
    async def __aenter__(self):
        self.on_request()
        return self
    async def __aexit__(self, *args):
        return False

class Store:
    def __init__(self, recording=False):
        self.lock = asyncio.Lock()
        self.active = self.ready = True
        self.managed = {"device_tracker.test"}
        self.devices = set(self.managed) if recording else set()
        self.generations = {}
        self.calls = []
    def cached_address(self, *args):
        pass
    def save_address(self, *args):
        pass
    async def run(self, fn, *args):
        self.calls.append(fn.__name__)
        if fn.__name__ == "<lambda>":
            return (1,)
        return None

class LiveAddressTest(unittest.IsolatedAsyncioTestCase):
    def setup_resolver(self, recording=False):
        self.store = Store(recording)
        self.runtime = {"cache": {}, "lock": asyncio.Lock(), "last_request": -1000}
        self.state = {"store": self.store, "address_runtime": self.runtime,
                      "active": {"service_key": "test"}}
        self.pos = (28.0, 116.0, 10)
        self.hass = SimpleNamespace(states=SimpleNamespace(get=lambda entity: self.pos))
        self.results = []
        self.connection = SimpleNamespace(user=SimpleNamespace(is_admin=True),
                                          send_result=lambda _, result: self.results.append(result))
        self.requests = 0
        self.change = lambda: None
        def request(*args, **kwargs):
            def on_request():
                self.requests += 1
                self.change()
            return Response(on_request)
        ns = dict(current_admin=admin, connection_admin=lambda c: c.user.is_admin,
                  position=lambda state: state, gcj=lambda lon, lat: (lon, lat),
                  now_ms=lambda: int(time.time()*1000), WINDOW=2592000000,
                  ADDRESS_FAILURE_TTL_MS=60000, ADDRESS_REQUEST_INTERVAL_S=0,
                  ADDRESS_REQUEST_TIMEOUT_S=10, time=time, asyncio=asyncio, json=json,
                  async_get_clientsession=lambda hass: SimpleNamespace(get=request),
                  security=SimpleNamespace(read_limited=read_limited))
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), "exec"), ns)
        self.resolve = ns["resolve_address"]

    async def address(self):
        await self.resolve(self.hass, self.connection, {"id": 1}, self.state,
                           self.store, "device_tracker.test", self.runtime)
        return self.results[-1]["address"]

    async def test_live_without_recording_never_accesses_db(self):
        self.setup_resolver()
        self.assertEqual(await self.address(), "Current address")
        self.assertEqual(await self.address(), "Current address")
        self.assertEqual(self.requests, 1)
        self.assertEqual(self.store.calls, [])
        self.pos = (28.1, 116.1, 10)
        self.assertEqual(await self.address(), "Current address")
        self.assertEqual(self.requests, 2)
        self.assertEqual(len(self.runtime["cache"]), 1)
        self.assertEqual(self.store.calls, [])

    async def test_recording_retains_persistent_address_cache(self):
        self.setup_resolver(recording=True)
        self.assertEqual(await self.address(), "Current address")
        self.assertIn("cached_address", self.store.calls)
        self.assertIn("save_address", self.store.calls)

    async def test_remove_during_request_discards_response(self):
        self.setup_resolver()
        self.change = self.store.managed.clear
        self.assertIsNone(await self.address())
        self.assertEqual(self.runtime["cache"], {})
        self.assertEqual(self.store.calls, [])

    async def test_position_changed_during_request_discards_response(self):
        self.setup_resolver()
        self.change = lambda: setattr(self, "pos", (29.0, 117.0, 10))
        self.assertIsNone(await self.address())
        self.assertEqual(self.runtime["cache"], {})

    async def test_recording_changed_during_request_discards_response(self):
        self.setup_resolver(recording=True)
        def change():
            self.store.devices.clear()
            self.store.generations["device_tracker.test"] = 1
        self.change = change
        self.assertIsNone(await self.address())
        self.assertNotIn("save_address", self.store.calls)

    async def test_removed_device_cannot_resolve(self):
        self.setup_resolver()
        self.store.managed.clear()
        self.assertIsNone(await self.address())
        self.assertEqual(self.requests, 0)
