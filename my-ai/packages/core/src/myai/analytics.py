"""Privacy-conscious analytics. No names, employers, or demographics."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone

_EVENTS: list[dict] = []


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
        "retention": "Anonymous in-memory events for the current process only. Not written to disk.",
    }


def reset() -> None:
    _EVENTS.clear()
