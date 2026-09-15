from __future__ import annotations

from collections import defaultdict

from .config import EVENT_TO_METRICS, HIGH_CONFIDENCE_SCENARIO_COUNT, TARGET_OBSERVATIONS
from .models import AssessmentSession, MetricResult, UserFitVector


def score_metrics(session: AssessmentSession) -> list[MetricResult]:
    values: dict[str, list[float]] = defaultdict(list)
    evidence: dict[str, list[str]] = defaultdict(list)
    scenarios: dict[str, set[str]] = defaultdict(set)

    for event in session.events:
        for metric in EVENT_TO_METRICS.get(event.event_type, ()):
            values[metric].append(event.strength)
            scenarios[metric].add(event.scenario_id)
            if event.evidence:
                evidence[metric].append(event.evidence)

    results: list[MetricResult] = []
    for metric, observations in values.items():
        score = sum(observations) / len(observations)
        target = TARGET_OBSERVATIONS.get(metric, 4)
        observation_confidence = min(1.0, len(observations) / target)
        scenario_bonus = min(1.0, len(scenarios[metric]) / HIGH_CONFIDENCE_SCENARIO_COUNT)
        confidence = min(1.0, (observation_confidence * 0.7) + (scenario_bonus * 0.3))
        results.append(
            MetricResult(
                name=metric,
                score=round(score, 4),
                confidence=round(confidence, 4),
                observations=len(observations),
                scenario_ids=sorted(scenarios[metric]),
                evidence=evidence.get(metric, [])[:8],
            )
        )
    return sorted(results, key=lambda x: x.name)


def build_user_vector(metrics: list[MetricResult]) -> UserFitVector:
    return UserFitVector(
        values={m.name: m.score for m in metrics},
        confidence={m.name: m.confidence for m in metrics},
    )
