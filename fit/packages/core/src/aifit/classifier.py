"""Optional structured LLM classifier.

Keyword heuristics remain first-class. An LLM, if configured, may only emit
the same event types and is treated as one additional feature source.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from .events import classify_free_text
from .models import InteractionEvent

ALLOWED_EVENTS = {
    "asked_clarification",
    "requested_evidence",
    "requested_sources",
    "requested_comparison",
    "requested_alternative",
    "challenged_assumption",
    "changed_constraint",
    "corrected_output",
    "requested_recommendation",
    "delegated_action",
    "requested_step_by_step",
    "requested_summary",
    "requested_visual",
    "requested_code",
    "requested_automation",
    "requested_integration",
    "chose_fast_path",
    "chose_deep_path",
    "chose_local_control",
    "chose_cloud_service",
    "chose_lower_cost",
    "chose_best_quality",
}


def classify_text(
    text: str,
    scenario_id: str,
    turn_id: str | None = None,
    *,
    use_llm: bool | None = None,
) -> list[InteractionEvent]:
    events = classify_free_text(text, scenario_id, turn_id)
    if use_llm is False:
        return events
    extra = _maybe_llm_events(text, scenario_id, turn_id)
    seen = {e.event_type for e in events}
    for event in extra:
        if event.event_type not in seen:
            events.append(event)
            seen.add(event.event_type)
    return events


def _maybe_llm_events(text: str, scenario_id: str, turn_id: str | None) -> list[InteractionEvent]:
    key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key or not text.strip():
        return []
    # v0.1 ships the adapter and schema. Live provider calls stay optional so
    # local/dev scoring never depends on a model as the decision maker.
    try:
        payload = _post_structured(text, key)
    except Exception:
        return []
    results: list[InteractionEvent] = []
    for row in payload.get("events", []):
        event_type = row.get("event_type")
        if event_type not in ALLOWED_EVENTS:
            continue
        results.append(
            InteractionEvent(
                event_type=event_type,
                scenario_id=scenario_id,
                turn_id=turn_id,
                strength=min(1.0, max(0.0, float(row.get("strength", 0.6)))),
                evidence=row.get("evidence") or "LLM classifier feature (not a final recommendation).",
                source_text=text,
                classifier="llm_v0.1",
                metadata={"model": payload.get("model"), "version": payload.get("version")},
            )
        )
    return results


def _post_structured(text: str, _key: str) -> dict:
    """Provider-agnostic hook. Disabled unless AIFIT_LLM_CLASSIFIER=1."""
    if os.environ.get("AIFIT_LLM_CLASSIFIER") != "1":
        return {"events": [], "model": None, "version": "disabled"}
    # Keep the HTTP shape explicit without binding scoring to one vendor.
    body = json.dumps({"text": text, "allowed_events": sorted(ALLOWED_EVENTS)}).encode()
    endpoint = os.environ.get("AIFIT_LLM_CLASSIFIER_URL")
    if not endpoint:
        return {"events": [], "model": None, "version": "no_endpoint"}
    req = urllib.request.Request(endpoint, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as response:
        return json.loads(response.read().decode())
