"""Bounded inputs for location APIs (no Home Assistant dependency)."""
import math
import re
from .const import MAP_PROXY_RATE_WINDOW_S

def entity_id(value):
    if not isinstance(value, str) or len(value) > 255 or not re.fullmatch(r"device_tracker\.[a-z0-9_]+", value):
        raise ValueError("Invalid device tracker")
    return value

def timestamp(value):
    if type(value) is not int or not 0 <= value <= 253402300799999:
        raise ValueError("Invalid timestamp")
    return value

def coordinate(value, bound):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not -bound <= value <= bound or not math.isfinite(value):
        raise ValueError("Invalid coordinate")
    return float(value)

def session_path(value):
    if not isinstance(value, str) or not re.fullmatch(r"/api/luxe_location/[A-Za-z0-9_-]{43}/_AMapService", value):
        raise ValueError("Invalid session path")
    return value

async def read_limited(content, limit):
    """Read the entire bounded response, not a single potentially partial chunk."""
    body = bytearray()
    async for chunk in content.iter_chunked(16384):
        if len(body) + len(chunk) > limit:
            raise ValueError("Response too large")
        body.extend(chunk)
    return bytes(body)

def reserve_proxy(runtime, session, now):
    """Single event-loop admission; no awaits between accounting and reservation."""
    times = session["times"]
    times[:] = [t for t in times if now-t < MAP_PROXY_RATE_WINDOW_S]
    total = runtime["times"]
    total[:] = [t for t in total if now-t < MAP_PROXY_RATE_WINDOW_S]
    if len(times) >= 120 or len(total) >= 600 or runtime["inflight"] >= 8:
        return False
    times.append(now)
    total.append(now)
    runtime["inflight"] += 1
    return True
