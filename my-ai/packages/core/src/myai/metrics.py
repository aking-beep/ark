"""Turn interaction events into normalized preference metrics.

A metric score is the share of opportunities the person took, not the mean
strength of the times they took it. See docs/SCORING_SPEC.md.
"""

from __future__ import annotations

from collections import defaultdict
from functools import lru_cache
from typing import Mapping

from .config import EVENT_TO_METRICS, HIGH_CONFIDENCE_SCENARIO_COUNT, OPPOSING_METRICS, TARGET_OBSERVATIONS
from .models import AssessmentSession, MetricResult, UserFitVector


@lru_cache(maxsize=4)
def _offered_from_catalogue(root: str) -> dict[str, frozenset[str]]:
    from pathlib import Path

    from .scenarios import load_scenarios

    path = Path(root) / "data/scenarios/scenarios.json"
    if not path.exists():
        return {}
    offered: dict[str, set[str]] = defaultdict(set)
    for scenario in load_scenarios(path):
        for turn in scenario.turns:
            for choice in turn.choices:
                for event in choice.events:
                    offered[scenario.id].update(EVENT_TO_METRICS.get(event.event_type, ()))
    return {k: frozenset(v) for k, v in offered.items()}


def offered_metrics() -> dict[str, frozenset[str]]:
    """Metrics each catalogue scenario lets the person express (scenario id -> metrics)."""
    from .engine import repo_root

    return _offered_from_catalogue(str(repo_root()))


def score_metrics(
    session: AssessmentSession,
    offered: Mapping[str, frozenset[str] | set[str]] | None = None,
) -> list[MetricResult]:
    """Score every metric the session had an opportunity to express.

    For metric ``m``:

    * opportunities = scenarios the person played (any event carries that
      scenario id) whose choices offered ``m``, plus any scenario where ``m``
      was observed anyway (for example from free text);
    * per opportunity, ``hit = max(strength of m events) - max(strength of
      opposing events)``, clamped to ``[0, 1]`` (chose_lower_cost and
      chose_best_quality cancel out inside one scenario);
    * ``score = sum(hit) / opportunities``.
    """
    offered = offered_metrics() if offered is None else offered
    played = {event.scenario_id for event in session.events}

    # strongest signal per (metric, scenario), and raw event counts
    best: dict[str, dict[str, float]] = defaultdict(dict)
    touched: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    evidence: dict[str, list[str]] = defaultdict(list)
    for event in session.events:
        for metric in EVENT_TO_METRICS.get(event.event_type, ()):
            sid = event.scenario_id
            best[metric][sid] = max(best[metric].get(sid, 0.0), event.strength)
            touched[metric][sid] += 1
            if event.evidence:
                evidence[metric].append(event.evidence)

    opportunities: dict[str, set[str]] = defaultdict(set)
    for sid in played:
        for metric in offered.get(sid, ()):
            opportunities[metric].add(sid)
    for metric, by_scenario in best.items():
        opportunities[metric].update(by_scenario)

    results: list[MetricResult] = []
    for metric, scenario_ids in opportunities.items():
        opposite = OPPOSING_METRICS.get(metric)
        hits = 0.0
        observations = 0
        for sid in scenario_ids:
            positive = best[metric].get(sid, 0.0)
            negative = best[opposite].get(sid, 0.0) if opposite else 0.0
            hits += min(1.0, max(0.0, positive - negative))
            signals = touched[metric].get(sid, 0) + (touched[opposite].get(sid, 0) if opposite else 0)
            # A declined opportunity is still one observation of the habit.
            observations += signals or 1
        score = hits / len(scenario_ids)
        target = TARGET_OBSERVATIONS.get(metric, 4)
        observation_confidence = min(1.0, observations / target)
        scenario_bonus = min(1.0, len(scenario_ids) / HIGH_CONFIDENCE_SCENARIO_COUNT)
        confidence = min(1.0, (observation_confidence * 0.7) + (scenario_bonus * 0.3))
        results.append(
            MetricResult(
                name=metric,
                score=round(score, 4),
                confidence=round(confidence, 4),
                observations=observations,
                scenario_ids=sorted(scenario_ids),
                evidence=evidence.get(metric, [])[:8],
            )
        )
    return sorted(results, key=lambda x: x.name)


def build_user_vector(metrics: list[MetricResult]) -> UserFitVector:
    return UserFitVector(
        values={m.name: m.score for m in metrics},
        confidence={m.name: m.confidence for m in metrics},
    )
