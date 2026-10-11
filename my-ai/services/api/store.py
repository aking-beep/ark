"""Durable key-value store for sessions, scores, and shares.

Backends, in order of preference:

1. Upstash / Vercel KV REST when the env vars are set (survives serverless).
2. Filesystem under MYAI_STORE (local and single-instance).

The backend is always the source of truth, so a delete on one instance is seen
by every other instance on the next read. Process memory is only a bounded,
short-lived fallback for writes the backend refused (disk full, Redis down).

On Vercel without Redis/KV, filesystem writes to /tmp are not shared across
instances, so the client still keeps a hash fallback on share links.

Every record expires after DEFAULT_TTL_SECONDS (30 days): Redis via EX, the
filesystem via a read-time age check plus a periodic sweep.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from pathlib import Path
from typing import Any, Generic, Hashable, TypeVar

DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days
FALLBACK_TTL_SECONDS = 60 * 10
FALLBACK_MAX_ENTRIES = 2048
SWEEP_INTERVAL_SECONDS = 60 * 60

KEY_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")
KIND_RE = re.compile(r"^[a-z_]{1,32}$")

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class BoundedCache(Generic[K, V]):
    """Thread-safe LRU with a per-entry TTL. maxsize <= 0 disables caching."""

    def __init__(self, maxsize: int, ttl_seconds: float) -> None:
        self.maxsize = maxsize
        self.ttl = ttl_seconds
        self._data: OrderedDict[K, tuple[float, V]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: K) -> V | None:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires, value = item
            if expires < time.monotonic():
                self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            return value

    def set(self, key: K, value: V) -> None:
        if self.maxsize <= 0:
            return
        with self._lock:
            self._data[key] = (time.monotonic() + self.ttl, value)
            self._data.move_to_end(key)
            while len(self._data) > self.maxsize:
                self._data.popitem(last=False)

    def pop(self, key: K) -> V | None:
        with self._lock:
            item = self._data.pop(key, None)
            return item[1] if item else None

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __contains__(self, key: object) -> bool:
        return self.get(key) is not None  # type: ignore[arg-type]

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)


def valid_key(key: str) -> bool:
    return isinstance(key, str) and bool(KEY_RE.fullmatch(key))


class ResultStore:
    def __init__(self) -> None:
        self.memory: BoundedCache[str, dict[str, Any]] = BoundedCache(FALLBACK_MAX_ENTRIES, FALLBACK_TTL_SECONDS)
        redis_url = os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL")
        redis_token = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN")
        self.redis_url = redis_url.rstrip("/") if redis_url else None
        self.redis_token = redis_token
        self.root = Path(os.environ.get("MYAI_STORE", "/tmp/myai-store")).resolve()
        self.ttl = DEFAULT_TTL_SECONDS
        self._last_sweep = 0.0
        if self.redis_url and self.redis_token:
            self.backend = "redis"
        else:
            self.backend = "filesystem"

    @property
    def durable(self) -> bool:
        if self.backend == "redis":
            return True
        if os.environ.get("VERCEL"):
            return False
        return True

    def _key(self, kind: str, key: str) -> str:
        return f"myai:{kind}:{key}"

    def _check(self, kind: str, key: str) -> None:
        if not isinstance(kind, str) or not KIND_RE.fullmatch(kind):
            raise ValueError("invalid store kind")
        if not valid_key(key):
            raise ValueError("invalid store key")

    def _path(self, kind: str, key: str) -> Path:
        """Resolve the file for kind/key, refusing anything outside root/kind."""
        self._check(kind, key)
        folder = (self.root / kind).resolve()
        path = (folder / f"{key}.json").resolve()
        if path.parent != folder or not path.is_relative_to(self.root):
            raise ValueError("store path escapes its folder")
        return path

    def put(self, kind: str, key: str, payload: dict[str, Any], ttl: int = DEFAULT_TTL_SECONDS) -> bool:
        self._check(kind, key)
        if self.backend == "redis":
            ok = self._redis_put(kind, key, payload, ttl)
        else:
            ok = self._fs_put(kind, key, payload)
            self._maybe_sweep()
        if ok:
            self.memory.pop(self._key(kind, key))
        else:
            self.memory.set(self._key(kind, key), payload)
        return ok

    def get(self, kind: str, key: str) -> dict[str, Any] | None:
        if not valid_key(key):
            return None
        self._check(kind, key)
        loaded = self._redis_get(kind, key) if self.backend == "redis" else self._fs_get(kind, key)
        if loaded is not None:
            return loaded
        return self.memory.get(self._key(kind, key))

    def delete(self, kind: str, key: str) -> None:
        if not valid_key(key):
            return
        self._check(kind, key)
        self.memory.pop(self._key(kind, key))
        if self.backend == "redis":
            self._redis_cmd("DEL", self._key(kind, key))
            return
        try:
            self._path(kind, key).unlink(missing_ok=True)
        except OSError:
            return

    def _fs_put(self, kind: str, key: str, payload: dict[str, Any]) -> bool:
        try:
            path = self._path(kind, key)
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{key}.", suffix=".tmp")
            try:
                with os.fdopen(fd, "w") as handle:
                    json.dump(payload, handle)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(tmp, path)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
            return True
        except (OSError, TypeError, ValueError):
            return False

    def _expired(self, path: Path, now: float | None = None) -> bool:
        try:
            return (now or time.time()) - path.stat().st_mtime > self.ttl
        except OSError:
            return False

    def _fs_get(self, kind: str, key: str) -> dict[str, Any] | None:
        try:
            path = self._path(kind, key)
            if not path.exists():
                return None
            if self._expired(path):
                path.unlink(missing_ok=True)
                return None
            raw = json.loads(path.read_text())
            return raw if isinstance(raw, dict) else None
        except (OSError, ValueError):
            return None

    def _maybe_sweep(self) -> None:
        now = time.time()
        if now - self._last_sweep < SWEEP_INTERVAL_SECONDS:
            return
        self._last_sweep = now
        self.sweep(now)

    def sweep(self, now: float | None = None) -> int:
        """Delete filesystem records older than the TTL. Returns how many were removed."""
        if self.backend != "filesystem" or not self.root.exists():
            return 0
        removed = 0
        now = now or time.time()
        for folder in self.root.iterdir():
            if not folder.is_dir() or not KIND_RE.fullmatch(folder.name):
                continue
            for path in folder.iterdir():
                # Stale temp files from a crashed write are swept too.
                if path.suffix not in {".json", ".tmp"}:
                    continue
                if self._expired(path, now):
                    try:
                        path.unlink()
                        removed += 1
                    except OSError:
                        continue
        return removed

    def _redis_put(self, kind: str, key: str, payload: dict[str, Any], ttl: int) -> bool:
        body = self._redis_cmd("SET", self._key(kind, key), json.dumps(payload), "EX", str(ttl))
        return body is not None

    def _redis_get(self, kind: str, key: str) -> dict[str, Any] | None:
        body = self._redis_cmd("GET", self._key(kind, key))
        if not body:
            return None
        result = body.get("result")
        if not result:
            return None
        try:
            raw = json.loads(result)
        except json.JSONDecodeError:
            return None
        return raw if isinstance(raw, dict) else None

    def _redis_cmd(self, *parts: str) -> dict[str, Any] | None:
        if not self.redis_url or not self.redis_token:
            return None
        request = urllib.request.Request(
            self.redis_url,
            data=json.dumps(list(parts)).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.redis_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            return None


STORE = ResultStore()
