from __future__ import annotations

import base64
import json
import os
import re
import sys
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Annotated, Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages/core/src"))

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi import Path as PathParam
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from myai.analytics import scrub_session
from myai.analytics import summary as analytics_summary
from myai.analytics import track
from myai.classifier import classify_text
from myai.engine import normalize_free_text, score_session
from myai.exports import export_persona
from myai.fit import rank_models_by_workload, rank_products
from myai.freshness import freshness_report
from myai.models import (
    MAX_SESSION_EVENTS,
    MAX_TEXT_LENGTH,
    AssessmentSession,
    FitFilters,
    InteractionEvent,
    UserFitVector,
)
from myai.persona import generate_persona
from myai.registry import load_models, load_products
from myai.scenarios import load_scenarios

from .store import STORE as RESULT_STORE

MAX_BODY_BYTES = 1024 * 1024
UUID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
UUID_RE = re.compile(UUID_PATTERN)
MAX_BATCH_EVENTS = 50
MAX_ID_LENGTH = 64
MAX_VECTOR_KEYS = 64
MAX_FEEDBACK_ROWS = 1000
MAX_SHARES_PER_SESSION = 50


class BodySizeLimit:
    """Reject request bodies over MAX_BODY_BYTES (declared or streamed) with 413."""

    def __init__(self, app, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")
        if declared is not None:
            try:
                too_big = int(declared) > self.max_bytes
            except ValueError:
                too_big = True
            if too_big:
                await _send_413(send)
                return
        # Buffer the body up to the cap, then replay it, so chunked uploads are capped too.
        chunks: list[bytes] = []
        size = 0
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                await _send_413(send)
                return
            chunks.append(chunk)
            more = message.get("more_body", False)
        body = b"".join(chunks)
        replayed = False

        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


async def _send_413(send) -> None:
    payload = json.dumps({"detail": "Request body too large."}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": payload})


class RateLimiter:
    """Sliding-window limit per client key, in process memory (per instance)."""

    def __init__(self, limit: int, window_seconds: float = 60.0, max_keys: int = 10_000) -> None:
        self.limit = limit
        self.window = window_seconds
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        if self.limit <= 0:
            return True
        now = time.monotonic()
        with self._lock:
            hits = self._hits.get(key)
            if hits is None:
                if len(self._hits) >= self.max_keys:
                    self._prune(now)
                hits = self._hits[key] = deque()
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True

    def _prune(self, now: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= now - self.window]:
            self._hits.pop(key, None)
        while len(self._hits) >= self.max_keys:
            self._hits.pop(next(iter(self._hits)))

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


SHARE_LIMIT = RateLimiter(int(os.environ.get("MYAI_SHARE_RATE_PER_MIN", "20")))
SCORE_LIMIT = RateLimiter(int(os.environ.get("MYAI_SCORE_RATE_PER_MIN", "60")))
# Ceilings across every client. A caller that rotates X-Forwarded-For gets a new
# per-client bucket each time, but cannot get past these.
SHARE_GLOBAL_LIMIT = RateLimiter(int(os.environ.get("MYAI_SHARE_GLOBAL_RATE_PER_MIN", "300")))
SCORE_GLOBAL_LIMIT = RateLimiter(int(os.environ.get("MYAI_SCORE_GLOBAL_RATE_PER_MIN", "1200")))
_LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


def _client_key(request: Request) -> str:
    """Client IP. X-Forwarded-For is trusted only from a loopback peer (the Next proxy)."""
    peer = request.client.host if request.client else "unknown"
    if peer in _LOOPBACK:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
        if forwarded:
            return forwarded[:64]
    return peer


def _rate_limit(limiter: RateLimiter, request: Request, global_limiter: RateLimiter | None = None) -> None:
    allowed = limiter.allow(_client_key(request))
    if allowed and global_limiter is not None:
        allowed = global_limiter.allow("*")
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many requests. Try again in a minute.")


app = FastAPI(title="AI Fit API", version="0.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(BodySizeLimit)

PRODUCTS = load_products(ROOT / "data/registry/products.json")
MODELS = load_models(ROOT / "data/registry/models.json")
# Bounded: feedback is an in-process sample, not a database.
FEEDBACK: deque[dict[str, Any]] = deque(maxlen=MAX_FEEDBACK_ROWS)

SessionIdPath = Annotated[str, PathParam(pattern=UUID_PATTERN, description="Session UUID")]
ShareIdPath = Annotated[str, PathParam(pattern=UUID_PATTERN, description="Share UUID")]
UuidField = Annotated[str, Field(pattern=UUID_PATTERN)]


def _persist(kind: str, key: str, payload: dict[str, Any]) -> bool:
    return RESULT_STORE.put(kind, key, payload)


def _load_persisted(kind: str, key: str) -> dict[str, Any] | None:
    return RESULT_STORE.get(kind, key)


def _get_session(session_id: str) -> AssessmentSession | None:
    # The store is the source of truth (no process cache), so a delete on one
    # instance is seen by every instance.
    raw = _load_persisted("sessions", session_id)
    if raw is None:
        return None
    try:
        return AssessmentSession.model_validate(raw)
    except ValidationError:
        return None


def _put_session(session: AssessmentSession) -> None:
    _persist("sessions", session.session_id, session.model_dump())


def _bounded_vector(value: dict[str, float]) -> dict[str, float]:
    if len(value) > MAX_VECTOR_KEYS:
        raise ValueError(f"at most {MAX_VECTOR_KEYS} dimensions")
    if any(len(k) > MAX_ID_LENGTH for k in value):
        raise ValueError(f"dimension names are limited to {MAX_ID_LENGTH} characters")
    return value


class FitRequest(BaseModel):
    values: dict[str, float]
    confidence: dict[str, float] = Field(default_factory=dict)
    filters: FitFilters | None = None

    _check_vectors = field_validator("values", "confidence")(_bounded_vector)


class PersonaRequest(BaseModel):
    values: dict[str, float]
    confidence: dict[str, float] = Field(default_factory=dict)

    _check_vectors = field_validator("values", "confidence")(_bounded_vector)


class EventBatch(BaseModel):
    events: list[InteractionEvent] = Field(default_factory=list, max_length=MAX_BATCH_EVENTS)
    free_text: str | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    scenario_id: str | None = Field(default=None, max_length=MAX_ID_LENGTH)
    turn_id: str | None = Field(default=None, max_length=MAX_ID_LENGTH)


class ExportRequest(BaseModel):
    persona: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] | None = None


class ClassifyRequest(BaseModel):
    text: str = Field(max_length=MAX_TEXT_LENGTH)
    scenario_id: str = Field(max_length=MAX_ID_LENGTH)
    turn_id: str | None = Field(default=None, max_length=MAX_ID_LENGTH)


class FeedbackRequest(BaseModel):
    session_id: UuidField | None = None
    share_id: UuidField | None = None
    rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=MAX_TEXT_LENGTH)
    useful: bool | None = None


class ScoreRequest(BaseModel):
    filters: FitFilters | None = None


class ScoreBody(BaseModel):
    session_id: UuidField
    events: list[InteractionEvent] = Field(default_factory=list, max_length=MAX_SESSION_EVENTS)
    filters: FitFilters | None = None


class ShareResult(BaseModel):
    """The scored-result fields a share snapshot copies. A missing one is a 400, not a 500."""

    model_config = ConfigDict(extra="ignore")

    persona: dict[str, Any]
    metrics: list[dict[str, Any]] = Field(max_length=64)
    products: list[dict[str, Any]] = Field(max_length=64)
    products_by_category: dict[str, list[dict[str, Any]]] = Field(max_length=64)
    models: dict[str, list[dict[str, Any]]] = Field(max_length=64)
    primary_stack: dict[str, Any]
    alternative_stack: dict[str, Any]
    user_vector: dict[str, Any]
    disclaimer: str = Field(max_length=MAX_TEXT_LENGTH)
    privacy: dict[str, Any]
    workstyle: dict[str, Any] | None = None
    operating_stack: list[dict[str, Any]] | None = Field(default=None, max_length=64)
    model_routing: Any = None
    workflow: Any = None
    instructions: str | None = Field(default=None, max_length=50_000)
    install_guides: Any = None
    share_card: str | None = Field(default=None, max_length=MAX_TEXT_LENGTH)

    @field_validator("persona")
    @classmethod
    def _persona_present(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not value:
            raise ValueError("Share payload needs a persona.")
        return value


class ShareBody(BaseModel):
    result: ShareResult
    # Links the snapshot to its session so deleting the session deletes the share too.
    session_id: UuidField | None = None


def _score_and_store(session: AssessmentSession, filters: FitFilters | None = None) -> dict[str, Any]:
    result = score_session(session, filters=filters)
    _put_session(session)
    _persist("scores", session.session_id, result)
    track("session_scored", session_id=session.session_id)
    return result


@app.get("/health")
def health():
    return {
        "ok": True,
        "version": "0.4.0",
        "privacy": "anonymous",
        "product": "AI Fit",
        "store": RESULT_STORE.backend,
        "durable": RESULT_STORE.durable,
    }


@app.get("/v1/scenarios")
def scenarios():
    return [s.model_dump() for s in load_scenarios()]


@app.post("/v1/sessions")
def create_session():
    session_id = str(uuid.uuid4())
    session = AssessmentSession(session_id=session_id, events=[])
    _put_session(session)
    track("session_created", session_id=session_id)
    return {"session_id": session_id, "events": []}


@app.post("/v1/sessions/demo")
def demo_session():
    raw = json.loads((ROOT / "examples/sample_session.json").read_text())
    raw["session_id"] = str(uuid.uuid4())
    session = AssessmentSession.model_validate(raw)
    result = _score_and_store(session)
    track("demo_session", session_id=session.session_id)
    return {"session_id": session.session_id, "session": session.model_dump(), "result": result}


@app.get("/v1/sessions/{session_id}")
def get_session(session_id: SessionIdPath):
    session = _get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown session")
    return {
        "session": session.model_dump(),
        "result": _load_persisted("scores", session_id),
    }


@app.post("/v1/sessions/{session_id}/events")
def add_events(session_id: SessionIdPath, batch: EventBatch):
    # Sessions are created by POST /v1/sessions. An unknown or deleted id is not
    # silently recreated, so a delete stays deleted.
    session = _get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown session")
    incoming = list(batch.events)
    if batch.free_text and batch.scenario_id:
        incoming.extend(normalize_free_text(batch.free_text, batch.scenario_id, batch.turn_id))
    for event in incoming:
        if not event.scenario_id and batch.scenario_id:
            event.scenario_id = batch.scenario_id
        if not event.turn_id and batch.turn_id:
            event.turn_id = batch.turn_id
    if len(session.events) + len(incoming) > MAX_SESSION_EVENTS:
        raise HTTPException(status_code=413, detail=f"A session holds at most {MAX_SESSION_EVENTS} events.")
    session.events.extend(incoming)
    _put_session(session)
    track("events_added", session_id=session_id, metadata={"count": len(incoming)})
    return {"session_id": session_id, "event_count": len(session.events)}


@app.post("/v1/sessions/{session_id}/score")
def score_stored_session(
    session_id: SessionIdPath,
    request: Request,
    payload: ScoreRequest | None = Body(default=None),
):
    _rate_limit(SCORE_LIMIT, request, SCORE_GLOBAL_LIMIT)
    session = _get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown session")
    filters = payload.filters if payload else None
    return _score_and_store(session, filters)


@app.post("/v1/sessions/{session_id}/share")
def share_session(session_id: SessionIdPath, request: Request):
    _rate_limit(SHARE_LIMIT, request, SHARE_GLOBAL_LIMIT)
    result = _load_persisted("scores", session_id)
    if result is None:
        session = _get_session(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Unknown session")
        result = _score_and_store(session)
    return _store_share(result, session_id)


def _link_share(session_id: str, share_id: str) -> None:
    index = _load_persisted("session_shares", session_id) or {}
    ids = [x for x in index.get("share_ids", []) if isinstance(x, str)]
    ids = (ids + [share_id])[-MAX_SHARES_PER_SESSION:]
    _persist("session_shares", session_id, {"share_ids": ids})


def _store_share(result: dict[str, Any], session_id: str | None = None) -> dict[str, Any]:
    share_id = str(uuid.uuid4())
    snapshot = {
        "share_id": share_id,
        "persona": result["persona"],
        "metrics": result["metrics"],
        "products": result["products"][:8],
        "products_by_category": result["products_by_category"],
        "models": {k: v[:2] for k, v in result["models"].items()},
        "primary_stack": result["primary_stack"],
        "alternative_stack": result["alternative_stack"],
        "user_vector": result["user_vector"],
        "workstyle": result.get("workstyle"),
        "operating_stack": result.get("operating_stack"),
        "model_routing": result.get("model_routing"),
        "workflow": result.get("workflow"),
        "instructions": result.get("instructions"),
        "install_guides": result.get("install_guides"),
        "share_card": result.get("share_card"),
        "disclaimer": result["disclaimer"],
        "privacy": result["privacy"],
    }
    persisted = _persist("shares", share_id, snapshot)
    if session_id:
        _link_share(session_id, share_id)
    track("session_shared", session_id=session_id)
    return {
        "share_id": share_id,
        "path": f"/share/{share_id}",
        "durable": bool(persisted and RESULT_STORE.durable),
    }


@app.post("/v1/share")
def publish_share(request: Request, payload: Any = Body(default=None)):
    _rate_limit(SHARE_LIMIT, request, SHARE_GLOBAL_LIMIT)
    try:
        body = ShareBody.model_validate(payload)
    except ValidationError as err:
        errors = err.errors(include_url=False, include_input=False)
        where = ".".join(str(x) for x in errors[0].get("loc", ())) if errors else ""
        detail = "Share payload needs a persona." if "persona" in where else f"Invalid share payload ({where or 'body'})."
        raise HTTPException(status_code=400, detail=detail) from None
    return _store_share(body.result.model_dump(), body.session_id)


@app.get("/v1/share/{share_id}")
def get_share(share_id: ShareIdPath):
    snapshot = _load_persisted("shares", share_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Unknown share")
    return snapshot


@app.get("/v1/sessions/{session_id}/export")
def export_session(session_id: SessionIdPath):
    session = _get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown session")
    return {
        "session": session.model_dump(),
        "result": _load_persisted("scores", session_id),
        "notice": "This export is the anonymous session record. No name or employer is stored.",
    }


@app.delete("/v1/sessions/{session_id}")
def delete_session(session_id: SessionIdPath):
    shares = _load_persisted("session_shares", session_id)
    existed = (
        _get_session(session_id) is not None
        or _load_persisted("scores", session_id) is not None
        or shares is not None
    )
    if not existed:
        raise HTTPException(status_code=404, detail="Unknown session")
    share_ids = [x for x in (shares or {}).get("share_ids", []) if isinstance(x, str) and UUID_RE.match(x)]
    for share_id in share_ids:
        RESULT_STORE.delete("shares", share_id)
    for kind in ("sessions", "scores", "session_shares"):
        RESULT_STORE.delete(kind, session_id)
    # Keep the anonymous counts, but forget which session they came from.
    for row in FEEDBACK:
        if row.get("session_id") == session_id:
            row["session_id"] = None
    scrub_session(session_id)
    track("session_deleted")
    return {"deleted": True, "session_id": session_id, "shares_deleted": len(share_ids)}


@app.post("/v1/score")
def score(payload: ScoreBody, request: Request):
    _rate_limit(SCORE_LIMIT, request, SCORE_GLOBAL_LIMIT)
    session = AssessmentSession(session_id=payload.session_id, events=payload.events)
    return _score_and_store(session, payload.filters)


@app.post("/v1/signal")
def signal(payload: ScoreBody):
    from myai.adaptive import diagnostic_signal

    session = AssessmentSession(session_id=payload.session_id, events=payload.events)
    return diagnostic_signal(session)


@app.post("/v1/fit")
def fit(payload: FitRequest):
    user = UserFitVector(values=payload.values, confidence=payload.confidence)
    product_recs = rank_products(user, PRODUCTS, filters=payload.filters)
    return {
        "products": [x.model_dump() for x in product_recs],
        "models": {
            w: [x.model_dump() for x in recs]
            for w, recs in rank_models_by_workload(MODELS).items()
            if recs
        },
        "persona": generate_persona(user),
    }


@app.get("/v1/registry/products")
def products():
    return [x.model_dump() for x in PRODUCTS]


@app.get("/v1/registry/models")
def models():
    return [x.model_dump() for x in MODELS]


@app.get("/v1/registry/freshness")
def registry_freshness():
    return freshness_report(PRODUCTS, MODELS)


@app.post("/v1/persona")
def persona(payload: PersonaRequest):
    user = UserFitVector(values=payload.values, confidence=payload.confidence)
    return generate_persona(user)


@app.post("/v1/classify")
def classify(payload: ClassifyRequest):
    events = classify_text(payload.text, payload.scenario_id, payload.turn_id)
    return {"events": [e.model_dump() for e in events], "note": "Classifier output is a feature source, not a recommendation."}


@app.post("/v1/export/{target}")
def export(target: str, payload: ExportRequest):
    from myai.exports import export_pack_zip

    allowed = {"generic", "claude", "agents", "cursor", "json", "chatgpt", "gemini", "profile", "routing", "pack"}
    if target not in allowed:
        raise HTTPException(status_code=400, detail="Unknown export target.")
    result = payload.result or {"persona": payload.persona}
    if "persona" not in result:
        result = {**result, "persona": payload.persona}
    if target == "pack":
        filename, blob = export_pack_zip(result)
        return {"filename": filename, "content": base64.b64encode(blob).decode("ascii"), "encoding": "base64"}
    filename, body = export_persona(payload.persona or result.get("persona") or {}, target, result)
    return {"filename": filename, "content": body, "encoding": "text"}


@app.post("/v1/feedback")
def feedback(payload: FeedbackRequest):
    row = payload.model_dump()
    row["id"] = str(uuid.uuid4())
    FEEDBACK.append(row)
    track("feedback", session_id=payload.session_id)
    return {"ok": True, "id": row["id"]}


@app.get("/v1/analytics/summary")
def analytics():
    return {**analytics_summary(), "feedback_count": len(FEEDBACK)}
