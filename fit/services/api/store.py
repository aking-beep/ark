"""Durable key-value store for sessions, scores, and shares.

Backends, in order of preference:

1. Upstash / Vercel KV REST when the env vars are set (survives serverless).
2. Filesystem under AIFIT_STORE (local and single-instance).
3. Process memory (tests and last-resort).

On Vercel without Redis/KV, filesystem writes to /tmp are not shared across
instances, so the client still keeps a hash fallback on share links.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days


class ResultStore:
    def __init__(self) -> None:
        self.memory: dict[str, dict[str, Any]] = {}
        redis_url = os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL")
        redis_token = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN")
        self.redis_url = redis_url.rstrip("/") if redis_url else None
        self.redis_token = redis_token
        self.root = Path(os.environ.get("AIFIT_STORE", "/tmp/aifit-store"))
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
        return f"aifit:{kind}:{key}"

    def put(self, kind: str, key: str, payload: dict[str, Any], ttl: int = DEFAULT_TTL_SECONDS) -> bool:
        self.memory[self._key(kind, key)] = payload
        if self.backend == "redis":
            return self._redis_put(kind, key, payload, ttl)
        return self._fs_put(kind, key, payload)

    def get(self, kind: str, key: str) -> dict[str, Any] | None:
        cached = self.memory.get(self._key(kind, key))
        if cached is not None:
            return cached
        loaded = self._redis_get(kind, key) if self.backend == "redis" else self._fs_get(kind, key)
        if loaded is not None:
            self.memory[self._key(kind, key)] = loaded
        return loaded

    def delete(self, kind: str, key: str) -> None:
        self.memory.pop(self._key(kind, key), None)
        if self.backend == "redis":
            self._redis_cmd("DEL", self._key(kind, key))
            return
        path = self.root / kind / f"{key}.json"
        try:
            if path.exists():
                path.unlink()
        except OSError:
            return

    def _fs_put(self, kind: str, key: str, payload: dict[str, Any]) -> bool:
        try:
            folder = self.root / kind
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"{key}.json").write_text(json.dumps(payload))
            return True
        except OSError:
            return False

    def _fs_get(self, kind: str, key: str) -> dict[str, Any] | None:
        path = self.root / kind / f"{key}.json"
        try:
            if not path.exists():
                return None
            raw = json.loads(path.read_text())
            return raw if isinstance(raw, dict) else None
        except (OSError, json.JSONDecodeError):
            return None

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
