from contextlib import closing
import importlib.util
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parent
module_path = path / 'database_migration.py'
if not module_path.exists():
    module_path = path.parent / 'custom_components' / 'locaris' / 'database_migration.py'
spec = importlib.util.spec_from_file_location('database_migration', module_path)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.old = self.root / 'luxe_location' / 'location.db'
        self.new = self.root / 'locaris' / 'location.db'

    def seed(self):
        self.old.parent.mkdir(parents=True)
        con = sqlite3.connect(self.old)
        self.addCleanup(con.close)
        con.execute('PRAGMA journal_mode=WAL')
        con.execute('PRAGMA wal_autocheckpoint=0')
        for table in migration.LEGACY_TABLES:
            con.execute(f'CREATE TABLE {table} (value TEXT)')
            con.execute(f'INSERT INTO {table} VALUES (?)', (table,))
        con.commit()
        return con

    def test_fresh(self):
        self.assertEqual(migration.migrate_database(self.old, self.new), 'fresh')
        self.assertFalse(self.new.exists())

    def test_copy_includes_committed_wal_and_all_tables(self):
        con = self.seed()
        con.execute("INSERT INTO probe_locations VALUES ('wal-only')")
        con.commit()
        self.assertTrue(Path(str(self.old)+'-wal').exists())
        self.assertEqual(migration.migrate_database(self.old, self.new), 'migrated')
        with closing(sqlite3.connect(self.new)) as dst, dst:
            for table in migration.LEGACY_TABLES:
                self.assertIn((table,), dst.execute(f'SELECT value FROM {table}').fetchall())
            self.assertIn(('wal-only',), dst.execute('SELECT value FROM probe_locations').fetchall())
        self.assertTrue(self.old.exists())
        self.assertFalse(list(self.new.parent.glob('.locaris-migration-*')))

    def test_existing_never_overwritten(self):
        self.seed()
        migration.migrate_database(self.old, self.new)
        with closing(sqlite3.connect(self.new)) as dst, dst:
            dst.execute("INSERT INTO probe_locations VALUES ('new-only')")
        self.assertEqual(migration.migrate_database(self.old, self.new), 'existing')
        with closing(sqlite3.connect(self.new)) as dst, dst:
            self.assertIn(('new-only',), dst.execute('SELECT value FROM probe_locations').fetchall())

    def test_corrupt_source(self):
        self.old.parent.mkdir()
        self.old.write_bytes(b'not a sqlite database')
        with self.assertRaises(sqlite3.DatabaseError):
            migration.migrate_database(self.old, self.new)
        self.assertFalse(self.new.exists())
        self.assertEqual(self.old.read_bytes(), b'not a sqlite database')
        self.assertFalse(list(self.new.parent.glob('.locaris-migration-*')))

    def test_incomplete_schema(self):
        self.old.parent.mkdir()
        with closing(sqlite3.connect(self.old)) as con, con:
            con.execute('CREATE TABLE unrelated (value TEXT)')
        with self.assertRaises(sqlite3.DatabaseError):
            migration.migrate_database(self.old, self.new)
        self.assertFalse(self.new.exists())

    def test_invalid_foreign_key(self):
        con = self.seed()
        con.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY)')
        con.execute('CREATE TABLE child (id INTEGER REFERENCES parent(id))')
        con.execute('INSERT INTO child VALUES (42)')
        con.commit()
        with self.assertRaises(sqlite3.DatabaseError):
            migration.migrate_database(self.old, self.new)
        self.assertFalse(self.new.exists())

    def test_missing_old_with_wal(self):
        self.old.parent.mkdir()
        Path(str(self.old)+'-wal').touch()
        with self.assertRaises(sqlite3.DatabaseError):
            migration.migrate_database(self.old, self.new)
        self.assertFalse(self.new.exists())

    def test_missing_new_with_wal(self):
        self.seed()
        self.new.parent.mkdir()
        Path(str(self.new)+'-wal').touch()
        with self.assertRaises(sqlite3.DatabaseError):
            migration.migrate_database(self.old, self.new)
        self.assertFalse(self.new.exists())

    def test_empty_destination_is_not_replaced(self):
        self.seed()
        self.new.parent.mkdir()
        self.new.touch()
        with self.assertRaises(sqlite3.DatabaseError):
            migration.migrate_database(self.old, self.new)
        self.assertEqual(self.new.stat().st_size, 0)

    def test_timeout_cleans_temporary(self):
        self.seed()
        with self.assertRaises(TimeoutError):
            migration.migrate_database(self.old, self.new, timeout=0)
        self.assertFalse(self.new.exists())
        self.assertFalse(list(self.new.parent.glob('.locaris-migration-*')))

    def test_publish_race_does_not_overwrite(self):
        self.seed()
        def race(src, target):
            target.write_bytes(b'other writer')
            raise FileExistsError()
        with patch.object(migration.os, 'link', race):
            with self.assertRaises(FileExistsError):
                migration.migrate_database(self.old, self.new)
        self.assertEqual(self.new.read_bytes(), b'other writer')
        self.assertFalse(list(self.new.parent.glob('.locaris-migration-*')))


if __name__ == '__main__':
    unittest.main()
