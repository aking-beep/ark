"""Scoring semantics: score = hits / opportunities, with trade-offs netting out."""

from __future__ import annotations

from myai.metrics import score_metrics
from myai.models import AssessmentSession, InteractionEvent

OFFERED = {
    "s1": frozenset({"evidence_seeking", "budget_sensitivity", "quality_preference", "code_comfort"}),
    "s2": frozenset({"evidence_seeking", "budget_sensitivity", "quality_preference"}),
    "s3": frozenset({"evidence_seeking", "code_comfort"}),
    "s4": frozenset({"evidence_seeking"}),
}


def ev(event_type: str, scenario_id: str, strength: float = 1.0) -> InteractionEvent:
    return InteractionEvent(event_type=event_type, scenario_id=scenario_id, strength=strength)


def scores(events: list[InteractionEvent]) -> dict[str, float]:
    session = AssessmentSession(session_id="t", events=events)
    return {m.name: m.score for m in score_metrics(session, offered=OFFERED)}


def metric(events: list[InteractionEvent], name: str):
    session = AssessmentSession(session_id="t", events=events)
    return next(m for m in score_metrics(session, offered=OFFERED) if m.name == name)


# Every played scenario offers evidence_seeking; "filler" events mark a scenario as played.
PLAYED = [ev("requested_summary", sid) for sid in ("s1", "s2", "s3", "s4")]


def test_one_hit_out_of_four_opportunities_is_not_a_perfect_score():
    result = scores(PLAYED + [ev("requested_evidence", "s1")])
    assert result["evidence_seeking"] == 0.25


def test_declined_opportunities_still_produce_a_score():
    result = scores(PLAYED)
    assert result["evidence_seeking"] == 0.0
    assert result["code_comfort"] == 0.0


def test_unplayed_scenarios_are_not_opportunities():
    result = scores([ev("requested_evidence", "s1"), ev("requested_summary", "s2")])
    assert result["evidence_seeking"] == 0.5
    assert "code_comfort" in result  # s1 offered it
    assert result["code_comfort"] == 0.0


def test_score_is_monotonic_in_hits():
    previous = -1.0
    events = list(PLAYED)
    for sid in ("s1", "s2", "s3", "s4"):
        events.append(ev("requested_evidence", sid))
        current = scores(events)["evidence_seeking"]
        assert current > previous
        previous = current
    assert previous == 1.0


def test_score_is_monotonic_in_strength():
    low = scores(PLAYED + [ev("requested_evidence", "s1", 0.4)])["evidence_seeking"]
    high = scores(PLAYED + [ev("requested_evidence", "s1", 0.9)])["evidence_seeking"]
    assert low < high


def test_repeating_a_hit_in_one_scenario_does_not_inflate_the_score():
    once = scores(PLAYED + [ev("requested_evidence", "s1")])["evidence_seeking"]
    thrice = scores(PLAYED + [ev("requested_evidence", "s1")] * 3)["evidence_seeking"]
    assert once == thrice


def test_opposing_choices_net_against_each_other():
    cheap = scores(PLAYED + [ev("chose_lower_cost", "s1"), ev("chose_lower_cost", "s2")])
    assert cheap["budget_sensitivity"] == 1.0
    assert cheap["quality_preference"] == 0.0

    mixed = scores(PLAYED + [ev("chose_lower_cost", "s1"), ev("chose_best_quality", "s1"), ev("chose_lower_cost", "s2")])
    assert mixed["budget_sensitivity"] == 0.5
    assert mixed["quality_preference"] == 0.0


def test_adding_an_opposing_choice_never_raises_the_score():
    base = scores(PLAYED + [ev("chose_lower_cost", "s1"), ev("chose_lower_cost", "s2")])["budget_sensitivity"]
    for strength in (0.2, 0.6, 1.0):
        after = scores(
            PLAYED + [ev("chose_lower_cost", "s1"), ev("chose_lower_cost", "s2"), ev("chose_best_quality", "s2", strength)]
        )["budget_sensitivity"]
        assert after <= base


def test_free_text_signal_outside_the_catalogue_counts_as_its_own_opportunity():
    result = scores([ev("requested_visual", "unknown-scene")])
    assert result["multimodal_preference"] == 1.0


def test_confidence_grows_with_opportunities_and_follows_the_spec():
    one = metric([ev("requested_evidence", "s1")], "evidence_seeking")
    four = metric(PLAYED + [ev("requested_evidence", sid) for sid in ("s1", "s2", "s3", "s4")], "evidence_seeking")
    assert one.confidence < four.confidence
    # confidence = 0.7 * min(1, observations / target) + 0.3 * min(1, opportunities / 2)
    assert one.confidence == round(0.7 * (1 / 4) + 0.3 * (1 / 2), 4)
    assert four.confidence == 1.0
    assert four.scenario_ids == ["s1", "s2", "s3", "s4"]


def test_scores_stay_bounded():
    events = PLAYED + [ev(t, sid, 1.0) for t in ("requested_evidence", "requested_sources") for sid in OFFERED]
    for value in scores(events).values():
        assert 0.0 <= value <= 1.0


def test_catalogue_offers_are_used_by_default():
    session = AssessmentSession(
        session_id="t",
        events=[InteractionEvent(event_type="requested_summary", scenario_id="launch-risk", turn_id="lr-2")],
    )
    names = {m.name: m for m in score_metrics(session)}
    # launch-risk offers evidence_seeking in lr-1/lr-2 even though it was not chosen.
    assert names["evidence_seeking"].score == 0.0
    assert names["conciseness_preference"].score == 1.0
