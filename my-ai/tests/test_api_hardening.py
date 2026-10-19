from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from services.api import main
from services.api.main import app
from services.api.store import STORE


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _scored_session(client: TestClient) -> tuple[str, dict]:
    session_id = client.post("/v1/sessions").json()["session_id"]
    added = client.post(
        f"/v1/sessions/{session_id}/events",
        json={
            "scenario_id": "launch-risk",
            "turn_id": "lr-1",
            "events": [{"event_type": "requested_evidence", "strength": 1.0}],
        },
    )
    assert added.status_code == 200
    scored = client.post(f"/v1/sessions/{session_id}/score")
    assert scored.status_code == 200
    return session_id, scored.json()


@pytest.mark.parametrize("bad", ["not-a-uuid", "..", "abc", "x" * 36, "%2e%2e"])
def test_session_paths_require_uuid(client: TestClient, bad: str):
    for method, path in (
        ("get", f"/v1/sessions/{bad}"),
        ("post", f"/v1/sessions/{bad}/score"),
        ("post", f"/v1/sessions/{bad}/share"),
        ("get", f"/v1/sessions/{bad}/export"),
        ("delete", f"/v1/sessions/{bad}"),
        ("get", f"/v1/share/{bad}"),
    ):
        res = getattr(client, method)(path)
        # ".." may be normalised by the client into another route; it must never succeed.
        assert res.status_code in {400, 404, 405, 422}, (method, path, res.status_code)
        assert res.status_code != 200


def test_path_traversal_never_reaches_the_store(client: TestClient, monkeypatch):
    seen: list[str] = []
    real_get = STORE.get

    def spy(kind: str, key: str):
        seen.append(key)
        return real_get(kind, key)

    monkeypatch.setattr(STORE, "get", spy)
    for path in ("/v1/share/..%2F..%2Fsessions%2Fx", "/v1/sessions/..%2Fshares%2Fx", "/v1/share/....//x"):
        assert client.get(path).status_code in {404, 422}
    assert seen == []


def test_body_session_ids_must_be_uuid(client: TestClient):
    event = {"event_type": "requested_evidence", "scenario_id": "launch-risk"}
    assert client.post("/v1/score", json={"session_id": "../sessions/x", "events": [event]}).status_code == 422
    assert client.post("/v1/signal", json={"session_id": "abc", "events": [event]}).status_code == 422
    assert client.post("/v1/feedback", json={"session_id": "abc", "rating": 4}).status_code == 422
    ok = client.post("/v1/score", json={"session_id": str(uuid.uuid4()), "events": [event]})
    assert ok.status_code == 200


def test_add_events_to_unknown_or_deleted_session_is_404(client: TestClient):
    unknown = str(uuid.uuid4())
    res = client.post(f"/v1/sessions/{unknown}/events", json={"events": []})
    assert res.status_code == 404
    assert STORE.get("sessions", unknown) is None

    session_id, _ = _scored_session(client)
    assert client.delete(f"/v1/sessions/{session_id}").status_code == 200
    again = client.post(
        f"/v1/sessions/{session_id}/events",
        json={"events": [{"event_type": "requested_code", "scenario_id": "weekend-build"}]},
    )
    assert again.status_code == 404
    assert STORE.get("sessions", session_id) is None


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"result": {}},
        {"result": {"persona": {}}},
        {"result": {"persona": {"label": "x"}}},  # missing metrics, products, ...
        {"result": "nope"},
        None,
    ],
)
def test_share_with_missing_fields_is_400_not_500(client: TestClient, payload):
    res = client.post("/v1/share", json=payload)
    assert res.status_code == 400
    assert res.json()["detail"]


def test_share_from_full_result_succeeds_and_drops_extra_fields(client: TestClient):
    _, result = _scored_session(client)
    res = client.post("/v1/share", json={"result": {**result, "evil": "x" * 10}})
    assert res.status_code == 200
    snap = client.get(f"/v1/share/{res.json()['share_id']}").json()
    assert "evil" not in snap
    assert snap["persona"] == result["persona"]


def test_delete_removes_linked_shares_and_scrubs_session_id(client: TestClient):
    from myai import analytics

    session_id, result = _scored_session(client)
    from_session = client.post(f"/v1/sessions/{session_id}/share").json()["share_id"]
    published = client.post("/v1/share", json={"result": result, "session_id": session_id}).json()["share_id"]
    unrelated = client.post("/v1/share", json={"result": result}).json()["share_id"]
    assert client.post("/v1/feedback", json={"session_id": session_id, "rating": 5}).status_code == 200
    assert any(e["session_id"] == session_id for e in analytics._EVENTS)

    deleted = client.delete(f"/v1/sessions/{session_id}")
    assert deleted.status_code == 200
    assert deleted.json()["shares_deleted"] == 2

    assert client.get(f"/v1/share/{from_session}").status_code == 404
    assert client.get(f"/v1/share/{published}").status_code == 404
    assert client.get(f"/v1/share/{unrelated}").status_code == 200
    assert client.get(f"/v1/sessions/{session_id}").status_code == 404
    assert client.get(f"/v1/sessions/{session_id}/export").status_code == 404
    assert all(row.get("session_id") != session_id for row in main.FEEDBACK)
    assert all(e.get("session_id") != session_id for e in analytics._EVENTS)
    assert client.delete(f"/v1/sessions/{session_id}").status_code == 404


def test_body_size_limit_returns_413(client: TestClient):
    big = "x" * (main.MAX_BODY_BYTES + 1)
    res = client.post("/v1/classify", content=big, headers={"content-type": "application/json"})
    assert res.status_code == 413

    def chunks():
        for _ in range(17):
            yield b"x" * 65536  # ~1.06 MB without a content-length

    streamed = client.post("/v1/classify", content=chunks(), headers={"content-type": "application/json"})
    assert streamed.status_code == 413


def test_string_and_list_limits(client: TestClient):
    long_text = {"text": "x" * 2001, "scenario_id": "launch-risk"}
    assert client.post("/v1/classify", json=long_text).status_code == 422
    session_id = client.post("/v1/sessions").json()["session_id"]
    many = [{"event_type": "requested_code", "scenario_id": "weekend-build"}] * (main.MAX_BATCH_EVENTS + 1)
    assert client.post(f"/v1/sessions/{session_id}/events", json={"events": many}).status_code == 422
    long_evidence = [{"event_type": "requested_code", "scenario_id": "w", "evidence": "x" * 2001}]
    assert client.post(f"/v1/sessions/{session_id}/events", json={"events": long_evidence}).status_code == 422
    too_many_dims = {"values": {f"d{i}": 0.5 for i in range(65)}}
    assert client.post("/v1/persona", json=too_many_dims).status_code == 422
    huge_session = {"session_id": str(uuid.uuid4()), "events": [many[0]] * 501}
    assert client.post("/v1/score", json=huge_session).status_code == 422


def test_session_event_total_is_capped(client: TestClient):
    session_id = client.post("/v1/sessions").json()["session_id"]
    batch = {"events": [{"event_type": "requested_code", "scenario_id": "weekend-build"}] * 50}
    for _ in range(10):
        assert client.post(f"/v1/sessions/{session_id}/events", json=batch).status_code == 200
    assert client.post(f"/v1/sessions/{session_id}/events", json=batch).status_code == 413


def test_share_and_score_are_rate_limited_per_client(client: TestClient, monkeypatch):
    monkeypatch.setattr(main.SHARE_LIMIT, "limit", 3)
    monkeypatch.setattr(main.SCORE_LIMIT, "limit", 2)
    _, result = _scored_session(client)
    a = {"x-forwarded-for": "203.0.113.1"}
    b = {"x-forwarded-for": "203.0.113.2"}
    codes = [client.post("/v1/share", json={"result": result}, headers=a).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    assert client.post("/v1/share", json={"result": result}, headers=b).status_code == 200

    body = {"session_id": str(uuid.uuid4()), "events": []}
    codes = [client.post("/v1/score", json=body, headers=a).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_rotating_forwarded_for_cannot_escape_the_global_ceiling(client: TestClient, monkeypatch):
    monkeypatch.setattr(main.SHARE_GLOBAL_LIMIT, "limit", 5)
    _, result = _scored_session(client)
    codes = [
        client.post("/v1/share", json={"result": result}, headers={"x-forwarded-for": f"203.0.113.{i}"}).status_code
        for i in range(7)
    ]
    assert codes == [200] * 5 + [429, 429]


def test_forwarded_for_is_ignored_from_non_loopback_peers():
    from starlette.requests import Request

    def req(peer: str, xff: str) -> Request:
        return Request(
            {
                "type": "http",
                "client": (peer, 1234),
                "headers": [(b"x-forwarded-for", xff.encode())],
            }
        )

    # The consumer proxy sends one address; a longer list means a client wrote it, so
    # only the right-most (nearest) entry counts.
    assert main._client_key(req("127.0.0.1", "198.51.100.7")) == "198.51.100.7"
    assert main._client_key(req("127.0.0.1", "203.0.113.66, 198.51.100.7")) == "198.51.100.7"
    assert main._client_key(req("192.0.2.9", "198.51.100.7")) == "192.0.2.9"
