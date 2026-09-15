"""Keyword/rule heuristics for free-text interaction events.

v0.1 keeps this deterministic. An optional LLM classifier can later emit
the same event types as one additional feature source.
"""

from __future__ import annotations

import re

from .models import InteractionEvent

KEYWORD_RULES: list[tuple[str, str, float]] = [
    (r"\b(source|citation|cite|evidence|proof|verify|primary)\b", "requested_sources", 0.85),
    (r"\b(compare|versus|vs\.?|tradeoff|trade-off|side[- ]by[- ]side)\b", "requested_comparison", 0.9),
    (r"\b(alternative|another option|other options)\b", "requested_alternative", 0.85),
    (r"\b(why assume|assumption|are we sure|is that true)\b", "challenged_assumption", 0.8),
    (r"\b(clarify|what do you mean|need more (info|information)|ambiguous)\b", "asked_clarification", 0.8),
    (r"\b(recommend|what should i|just tell me|make the call)\b", "requested_recommendation", 0.85),
    (r"\b(step[- ]by[- ]step|structured|outline|break it down)\b", "requested_step_by_step", 0.8),
    (r"\b(summar(y|ize)|brief|tl;dr|short version)\b", "requested_summary", 0.8),
    (r"\b(visual|image|mockup|diagram|storyboard)\b", "requested_visual", 0.85),
    (r"\b(code|implement|scaffold|repo|function)\b", "requested_code", 0.85),
    (r"\b(automat(e|ion)|orchestrat|workflow|n8n|zapier)\b", "requested_automation", 0.9),
    (r"\b(integrat|connect (it|this) to|api|slack|github)\b", "requested_integration", 0.85),
    (r"\b(local|self[- ]host|on[- ]prem|ollama)\b", "chose_local_control", 0.9),
    (r"\b(cloud|saas|hosted)\b", "chose_cloud_service", 0.7),
    (r"\b(cheap|cost|budget|lower[- ]cost|price)\b", "chose_lower_cost", 0.8),
    (r"\b(best quality|highest quality|do it right)\b", "chose_best_quality", 0.8),
    (r"\b(fast|quickly|now|today)\b", "chose_fast_path", 0.7),
    (r"\b(deep|thorough|underlying|first principles)\b", "chose_deep_path", 0.75),
    (r"\b(you (do|handle|take) it|just go ahead|delegate)\b", "delegated_action", 0.8),
]


def classify_free_text(text: str, scenario_id: str, turn_id: str | None = None) -> list[InteractionEvent]:
    """Return zero or more events from observable wording. Preserve source text."""
    if not text or not text.strip():
        return []
    lowered = text.lower()
    events: list[InteractionEvent] = []
    seen: set[str] = set()
    for pattern, event_type, strength in KEYWORD_RULES:
        if event_type in seen:
            continue
        if re.search(pattern, lowered):
            seen.add(event_type)
            events.append(
                InteractionEvent(
                    event_type=event_type,  # type: ignore[arg-type]
                    scenario_id=scenario_id,
                    turn_id=turn_id,
                    strength=strength,
                    evidence=f"Free-text matched {event_type.replace('_', ' ')}.",
                    source_text=text,
                    classifier="keyword_v0.1",
                )
            )
    return events
