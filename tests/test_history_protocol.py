"""Exercise the actual history websocket handler using dependency-free HA fakes."""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest

source = Path(__file__).resolve().parents[1] / "custom_components/locaris/__init__.py"
node = next(n for n in ast.parse(source.read_text()).body
            if isinstance(n, ast.AsyncFunctionDef) and n.name == "ws_history")
node.decorator_list = []

async def admin(hass, connection):
    return True

class Store:
    active = ready = True
    def __init__(self):
        self.lock = asyncio.Lock()
        self.managed = {"device_tracker.a"}
        self.generations = {}
        self.calls = 0
        self.revision = "session:a:0:0"
        self.status = "importing"
    def history_meta(self, entity):
        return {"revision": self.revision, "sync_status": self.status}
    async def run(self, fn):
        self.calls += 1
        return ([{"recorded_at": 100}], 0, False)

class HistoryProtocolTest(unittest.IsolatedAsyncioTestCase):
    async def test_conditional_request_skips_sql_but_updates_status(self):
        ns = dict(current_admin=admin, DOMAIN="locaris", HISTORY_QUERY_MAX_MS=100000)
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), "exec"), ns)
        store = Store()
        hass = SimpleNamespace(data={"locaris":{"store":store}})
        results = []
        conn = SimpleNamespace(send_result=lambda _, data: results.append(data),
                               send_error=lambda *args: self.fail(str(args)))
        msg = dict(id=1, entity_id="device_tracker.a", start=1, end=1000, collapse_repeated=False)
        handler = ns["ws_history"]
        await handler(hass, conn, msg)
        self.assertEqual(store.calls, 1)
        first = results[-1]
        self.assertFalse(first["unchanged"])
        self.assertEqual(first["points"], [{"recorded_at":100}])
        msg["known_revision"] = first["revision"]
        store.status = "ready"
        await handler(hass, conn, msg)
        self.assertEqual(store.calls, 1)
        self.assertTrue(results[-1]["unchanged"])
        self.assertEqual(results[-1]["sync_status"], "ready")
        self.assertNotIn("points", results[-1])
        store.revision = "session:a:0:1"
        await handler(hass, conn, msg)
        self.assertEqual(store.calls, 2)
        self.assertFalse(results[-1]["unchanged"])
        msg["known_revision"] = results[-1]["revision"]
        msg["end"] += 1
        await handler(hass, conn, msg)
        self.assertEqual(store.calls, 3)
        self.assertFalse(results[-1]["unchanged"])
