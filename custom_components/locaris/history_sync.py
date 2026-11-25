"""In-memory history revision and sync status; no location data stored."""
from uuid import uuid4

class HistorySync:
    def __init__(self):
        self.session = uuid4().hex
        self.versions = {}
        self.cleanup_version = 0
        self.completed = set()

    def changed(self, entity, count):
        if count > 0:
            self.versions[entity] = self.versions.get(entity, 0) + 1

    def invalidate(self, entity):
        self.changed(entity, 1)
        self.completed.discard(entity)

    def pruned(self, count):
        if count > 0:
            self.cleanup_version += 1

    def meta(self, entity, generation, enabled, importing, queued, retry):
        if not enabled:
            status = "disabled"
        elif retry:
            status = "retry"
        elif importing:
            status = "syncing" if entity in self.completed else "importing"
        elif queued:
            status = "queued"
        else:
            status = "ready"
        return {"revision": f"{self.session}:{self.cleanup_version}:{generation}:{self.versions.get(entity, 0)}",
                "sync_status": status}
