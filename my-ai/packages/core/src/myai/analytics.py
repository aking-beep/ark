"""Privacy-conscious analytics. No names, employers, or demographics."""

from __future__ import annotations

from collections import Counter, deque
from datetime import datetime, timezone

# Bounded so a long-lived process cannot grow without limit.
MAX_EVENTS = 5000
_EVENTS: deque[dict] = deque(maxlen=MAX_EVENTS)


def track(name: str, *, session_id: str | None = None, metadata: dict | None = None) -> dict:
    event = {
        "name": name,
        "at": datetime.now(timezone.utc).isoformat(),
        "session_id": session_id,
        "metadata": metadata or {},
    }
    _EVENTS.append(event)
    return event


def summary() -> dict:
    counts = Counter(event["name"] for event in _EVENTS)
    return {
        "event_count": len(_EVENTS),
        "counts": dict(counts),
        "retention": "Anonymous in-memory events for the current process only (last 5000). Not written to disk.",
    }


def scrub_session(session_id: str) -> int:
    """Forget which session produced each event (used when a session is deleted)."""
    scrubbed = 0
    for event in _EVENTS:
        if event.get("session_id") == session_id:
            event["session_id"] = None
            scrubbed += 1
    return scrubbed


def reset() -> None:
    _EVENTS.clear()
