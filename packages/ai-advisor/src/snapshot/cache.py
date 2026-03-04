"""Simple TTL cache for snapshots to avoid repeated API calls."""

from __future__ import annotations

import time
from typing import Any

from cachetools import TTLCache

from src.config import settings

_cache: TTLCache[str, Any] = TTLCache(maxsize=256, ttl=settings.snapshot_cache_ttl)


def cache_key(token_a: str, token_b: str) -> str:
    a, b = token_a.lower(), token_b.lower()
    return f"{a}:{b}"


def get_cached(key: str) -> Any | None:
    return _cache.get(key)


def set_cached(key: str, value: Any) -> None:
    _cache[key] = value


def invalidate(key: str) -> None:
    _cache.pop(key, None)


def clear_all() -> None:
    _cache.clear()
