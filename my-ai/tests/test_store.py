from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from services.api.store import ResultStore


def test_filesystem_store_roundtrip(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYAI_STORE", str(tmp_path))
    monkeypatch.delenv("UPSTASH_REDIS_REST_URL", raising=False)
    monkeypatch.delenv("KV_REST_API_URL", raising=False)
    store = ResultStore()
    assert store.backend == "filesystem"
    assert store.put("shares", "abc", {"persona": {"label": "Careful checker"}})
    loaded = store.get("shares", "abc")
    assert loaded is not None
    assert loaded["persona"]["label"] == "Careful checker"
    store.delete("shares", "abc")
    assert store.get("shares", "abc") is None


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
