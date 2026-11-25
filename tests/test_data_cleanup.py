"""Data cleanup tests without Home Assistant dependencies."""
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location(
    "locaris_cleanup_test",
    Path(__file__).resolve().parents[1] / "custom_components/locaris/data_cleanup.py",
)
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)

class CleanupTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data = self.root / "locaris"
        self.data.mkdir()
        for name in ("location.db", "location.db-wal", "location.db-shm"):
            (self.data / name).write_text("local")
        self.recorder = self.root / "home-assistant_v2.db"
        self.recorder.write_text("keep")
        self.other = self.root / "other"
        self.other.mkdir()
        (self.other / "keep").write_text("keep")
        async def executor(fn, *args):
            return fn(*args)
        self.hass = SimpleNamespace(
            data={}, config=SimpleNamespace(path=lambda name: str(self.root / name)),
            async_add_executor_job=executor,
        )

    async def remove(self, options):
        await cleanup.async_cleanup_entry(self.hass, SimpleNamespace(options=options))

    async def test_default_and_non_boolean_preserve(self):
        for options in ({}, {"delete_on_remove": False}, {"delete_on_remove": "true"}, {"delete_on_remove": 1}):
            await self.remove(options)
            self.assertTrue((self.data / "location.db").exists())

    async def test_delete_and_repeat(self):
        (self.data / "external").symlink_to(self.other, target_is_directory=True)
        await self.remove({"delete_on_remove": True})
        await self.remove({"delete_on_remove": True})
        self.assertFalse(self.data.exists())
        self.assertEqual(self.recorder.read_text(), "keep")
        self.assertEqual((self.other / "keep").read_text(), "keep")

    async def test_active_or_failed_unload_preserves(self):
        for state in ({"store": object()}, {"entry_id": "active"}):
            self.hass.data["locaris"] = state
            with self.assertLogs(cleanup._LOGGER, level="ERROR"):
                await self.remove({"delete_on_remove": True})
            self.assertTrue(self.data.exists())

    async def test_directory_symlink_refused(self):
        cleanup.remove_data_directory(self.data)
        self.data.symlink_to(self.other, target_is_directory=True)
        with self.assertLogs(cleanup._LOGGER, level="ERROR"):
            await self.remove({"delete_on_remove": True})
        self.assertTrue(self.data.is_symlink())
        self.assertTrue((self.other / "keep").exists())

    async def test_regular_file_refused(self):
        cleanup.remove_data_directory(self.data)
        self.data.write_text("unrelated")
        with self.assertLogs(cleanup._LOGGER, level="ERROR"):
            await self.remove({"delete_on_remove": True})
        self.assertEqual(self.data.read_text(), "unrelated")
