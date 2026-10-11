from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from services.api.store import DEFAULT_TTL_SECONDS, BoundedCache, ResultStore


@pytest.fixture
def fs_store(tmp_path: Path, monkeypatch) -> ResultStore:
    monkeypatch.setenv("MYAI_STORE", str(tmp_path / "store"))
    monkeypatch.delenv("UPSTASH_REDIS_REST_URL", raising=False)
    monkeypatch.delenv("KV_REST_API_URL", raising=False)
    store = ResultStore()
    assert store.backend == "filesystem"
    return store


def test_global_store_is_isolated_from_tmp_default():
    from services.api.store import STORE

    assert str(STORE.root) != str(Path("/tmp/myai-store").resolve())
    assert STORE.root == Path(os.environ["MYAI_STORE"]).resolve()


def test_filesystem_store_roundtrip(fs_store: ResultStore):
    assert fs_store.put("shares", "abc", {"persona": {"label": "Careful checker"}})
    loaded = fs_store.get("shares", "abc")
    assert loaded is not None
    assert loaded["persona"]["label"] == "Careful checker"
    fs_store.delete("shares", "abc")
    assert fs_store.get("shares", "abc") is None


@pytest.mark.parametrize(
    "key",
    ["../escape", "..", ".", "a/b", "a\\b", "", "x" * 65, "abc.json", "abc\x00", "%2e%2e"],
)
def test_store_rejects_unsafe_keys(fs_store: ResultStore, key: str):
    with pytest.raises(ValueError):
        fs_store.put("sessions", key, {"x": 1})
    assert fs_store.get("sessions", key) is None
    fs_store.delete("sessions", key)  # no-op, never raises or touches disk
    assert not any(fs_store.root.parent.glob("escape*"))


def test_store_rejects_unsafe_kinds(fs_store: ResultStore):
    for kind in ("../x", "Sessions", "a/b", ""):
        with pytest.raises(ValueError):
            fs_store.put(kind, "abc", {"x": 1})


def test_store_path_stays_inside_root(fs_store: ResultStore, tmp_path: Path):
    fs_store.put("sessions", "abc-123", {"x": 1})
    files = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert files == [fs_store.root / "sessions" / "abc-123.json"]


def test_filesystem_write_is_atomic(fs_store: ResultStore, monkeypatch):
    assert fs_store.put("scores", "k1", {"v": 1})

    def boom(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    # The failed write must leave the previous file intact and no temp file behind.
    assert fs_store.put("scores", "k1", {"v": 2}) is False
    monkeypatch.undo()
    folder = fs_store.root / "scores"
    assert sorted(p.name for p in folder.iterdir()) == ["k1.json"]
    assert (folder / "k1.json").read_text() == '{"v": 1}'
    # The backend copy wins over the in-memory fallback, and delete clears both.
    assert fs_store.get("scores", "k1") == {"v": 1}
    fs_store.delete("scores", "k1")
    assert fs_store.get("scores", "k1") is None


def test_filesystem_records_expire_after_ttl(fs_store: ResultStore):
    fs_store.put("sessions", "old", {"v": 1})
    fs_store.put("sessions", "new", {"v": 2})
    path = fs_store.root / "sessions" / "old.json"
    stale = time.time() - DEFAULT_TTL_SECONDS - 60
    os.utime(path, (stale, stale))
    assert fs_store.get("sessions", "old") is None
    assert not path.exists()

    fs_store.put("sessions", "old2", {"v": 3})
    path2 = fs_store.root / "sessions" / "old2.json"
    os.utime(path2, (stale, stale))
    assert fs_store.sweep() == 1
    assert not path2.exists()
    assert fs_store.get("sessions", "new") == {"v": 2}


def test_backend_is_source_of_truth_across_instances(fs_store: ResultStore):
    other = ResultStore()
    assert other.root == fs_store.root
    fs_store.put("sessions", "shared", {"v": 1})
    assert other.get("sessions", "shared") == {"v": 1}
    other.delete("sessions", "shared")
    # No stale process cache on the first instance.
    assert fs_store.get("sessions", "shared") is None


def test_bounded_cache_evicts_and_expires(monkeypatch):
    cache: BoundedCache[str, int] = BoundedCache(maxsize=2, ttl_seconds=10)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.get("a")
    cache.set("c", 3)
    assert cache.get("b") is None  # least recently used
    assert cache.get("a") == 1 and cache.get("c") == 3
    now = time.monotonic()
    monkeypatch.setattr(time, "monotonic", lambda: now + 11)
    assert cache.get("a") is None
    assert len(BoundedCache(0, 10)) == 0


def test_publish_share_and_reload():
    from services.api.main import app

    client = TestClient(app)
    demo = client.post("/v1/sessions/demo")
    result = demo.json()["result"]
    published = client.post("/v1/share", json={"result": result})
    assert published.status_code == 200
    share_id = published.json()["share_id"]
    assert published.json()["path"] == f"/share/{share_id}"
    snapshot = client.get(f"/v1/share/{share_id}")
    assert snapshot.status_code == 200
    assert snapshot.json()["persona"]["label"]


def test_health_reports_store():
    from services.api.main import app

    client = TestClient(app)
    health = client.get("/health")
    assert health.json()["ok"] is True
    assert health.json()["store"] in {"filesystem", "redis"}
    assert "durable" in health.json()
