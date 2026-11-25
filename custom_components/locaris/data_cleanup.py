"""Permanent removal of Locaris-owned local data."""
import logging
from pathlib import Path
import shutil

_LOGGER = logging.getLogger(__name__)
DELETE_ON_REMOVE = "delete_on_remove"

def delete_on_remove(entry):
    """Only an explicit boolean true opts into irreversible removal."""
    return entry.options.get(DELETE_ON_REMOVE) is True

def remove_data_directory(path):
    """Remove only the fixed integration directory, never follow symlinks."""
    path = Path(path)
    if path.is_symlink():
        raise OSError("Refusing to remove a symbolic link")
    if not path.exists():
        return
    if not path.is_dir() or not shutil.rmtree.avoids_symlink_attacks:
        raise OSError("Unsafe Locaris data directory")
    shutil.rmtree(path)

async def async_cleanup_entry(hass, entry):
    """Called only by HA's permanent config entry removal hook."""
    if not delete_on_remove(entry):
        return
    state = hass.data.get("locaris", {})
    # A failed unload or another loaded entry must never lose its database.
    if state.get("store") is not None or state.get("entry_id") is not None:
        _LOGGER.error("Locaris data cleanup skipped: storage has not stopped")
        return
    try:
        await hass.async_add_executor_job(
            remove_data_directory, hass.config.path("locaris")
        )
    except OSError:
        _LOGGER.exception("Locaris local data cleanup failed; manual cleanup may be required")
