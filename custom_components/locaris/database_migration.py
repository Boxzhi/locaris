"""Copy the retired integration's SQLite database once, without overwriting it."""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import tempfile
import time

LEGACY_TABLES = frozenset({"probe_management", "probe_paused", "probe_metadata",
                           "probe_devices", "probe_locations", "probe_address_cache"})


def _present(path):
    return os.path.lexists(path)


def _sidecars(path):
    return [Path(str(path) + suffix) for suffix in ("-wal", "-shm", "-journal")]


def migrate_database(source, target, timeout=30):
    """Return migrated, existing, or fresh; fail closed on incomplete databases.

    Caller must have stopped the legacy integration. Use SQLite backup (not a
    file copy) so committed WAL pages are included. Publish without replacing
    any destination file, and preserve the old database as a manual backup.
    """
    source, target = Path(source), Path(target)
    if _present(target):
        if not target.is_file() or target.stat().st_size == 0:
            raise sqlite3.DatabaseError("Invalid Locaris database; restore from backup")
        return "existing"
    if any(_present(p) for p in _sidecars(target)):
        raise sqlite3.DatabaseError("Locaris database sidecars exist without database")
    if not _present(source):
        if any(_present(p) for p in _sidecars(source)):
            raise sqlite3.DatabaseError("Legacy database sidecars exist without database")
        return "fresh"
    if not source.is_file() or source.stat().st_size == 0:
        raise sqlite3.DatabaseError("Invalid legacy location database")
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".locaris-migration-", suffix=".db", dir=target.parent)
    os.close(fd)
    temporary = Path(name)
    deadline = time.monotonic() + timeout

    def progress(status, remaining, total):
        if time.monotonic() >= deadline:
            raise TimeoutError("Legacy location database backup timed out")

    try:
        with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)) as src:
            with closing(sqlite3.connect(temporary, timeout=5)) as dst:
                src.backup(dst, pages=256, progress=progress, sleep=0.05)
                if dst.execute("PRAGMA journal_mode=DELETE").fetchone()[0].lower() != "delete":
                    raise sqlite3.DatabaseError("Could not finalize Locaris database snapshot")
                if dst.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise sqlite3.DatabaseError("Legacy location database integrity check failed")
                tables = {row[0] for row in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if not LEGACY_TABLES.issubset(tables):
                    raise sqlite3.DatabaseError("Legacy location database schema is incomplete")
                if dst.execute("PRAGMA foreign_key_check").fetchone() is not None:
                    raise sqlite3.DatabaseError("Legacy location database foreign key check failed")
        with temporary.open("rb") as file:
            os.fsync(file.fileno())
        if any(_present(p) for p in _sidecars(target)):
            raise sqlite3.DatabaseError("Locaris database sidecars appeared during migration")
        # Atomic no-clobber publication within the target directory (HA/Linux).
        os.link(temporary, target)
        dir_fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
        return "migrated"
    finally:
        for path in [temporary, *_sidecars(temporary)]:
            path.unlink(missing_ok=True)
