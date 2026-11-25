"""Bounded inputs for location APIs (no Home Assistant dependency)."""
import math
import re

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
