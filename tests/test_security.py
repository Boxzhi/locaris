"""Isolated security regression tests; no HA or network required."""
import asyncio
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("luxe_security", Path(__file__).resolve().parents[1] / "custom_components/luxe_location_probe/security.py")
security = importlib.util.module_from_spec(spec)
spec.loader.exec_module(security)

class SecurityTest(unittest.TestCase):
    def test_inputs(self):
        self.assertEqual(security.entity_id("device_tracker.phone"), "device_tracker.phone")
        for value in ("sensor.phone", "device_tracker.a/../b", "device_tracker."+"x"*256, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                security.entity_id(value)
        self.assertEqual(security.timestamp(1795577846955), 1795577846955)
        for value in (True, -1, 10**80, 1.5):
            with self.subTest(value=value), self.assertRaises(ValueError):
                security.timestamp(value)
        self.assertEqual(security.coordinate(90, 90), 90.0)
        for value in (True, float("nan"), float("inf"), -91, "12"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                security.coordinate(value, 90)
        path = "/api/luxe_location/"+"a"*43+"/_AMapService"
        self.assertEqual(security.session_path(path), path)
        for value in (path+"?x=1", path+"/", "/api/luxe_location/../_AMapService"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                security.session_path(value)

    def test_proxy_concurrency_and_rate(self):
        runtime = {"times": [], "inflight": 0}
        session = {"times": []}
        for _ in range(8):
            self.assertTrue(security.reserve_proxy(runtime, session, 1))
        self.assertFalse(security.reserve_proxy(runtime, session, 1))
        runtime["inflight"] = 0
        for _ in range(112):
            self.assertTrue(security.reserve_proxy(runtime, session, 2))
            runtime["inflight"] -= 1
        self.assertFalse(security.reserve_proxy(runtime, session, 2))
        self.assertTrue(security.reserve_proxy(runtime, session, 62))
        self.assertFalse(security.reserve_proxy({"times":[2]*600,"inflight":0}, {"times":[]}, 2))

class Content:
    async def iter_chunked(self, _size):
        yield b"abc"
        yield b"def"

class ResponseTest(unittest.IsolatedAsyncioTestCase):
    async def test_chunked_limit(self):
        self.assertEqual(await security.read_limited(Content(), 6), b"abcdef")
        with self.assertRaises(ValueError):
            await security.read_limited(Content(), 5)
