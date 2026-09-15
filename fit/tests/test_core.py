from pathlib import Path

from fastapi.testclient import TestClient

from aifit.engine import registry_errors, score_session
from aifit.events import classify_free_text
from aifit.exports import export_persona
from aifit.fit import rank_products
from aifit.metrics import build_user_vector, score_metrics
from aifit.models import AssessmentSession, FitFilters, ProductRecord
from aifit.persona import generate_persona
from aifit.scenarios import load_scenarios


def test_metrics_are_bounded():
    session = AssessmentSession(
        session_id="x",
        events=[{"event_type": "requested_evidence", "scenario_id": "s", "strength": 1.0}],
    )
    metrics = score_metrics(session)
    assert metrics
    assert all(0 <= x.score <= 1 for x in metrics)
    assert all(0 <= x.confidence <= 1 for x in metrics)


def test_product_ranking():
    session = AssessmentSession(
        session_id="x",
        events=[{"event_type": "requested_evidence", "scenario_id": "s", "strength": 1.0}],
    )
    user = build_user_vector(score_metrics(session))
    product = ProductRecord(
        id="p",
        name="P",
        provider="X",
        category="research",
        description="",
        fit_vector={"evidence_seeking": 1.0},
        last_evaluated_at="2026-09-03",
        registry_version="test",
        evidence=[{"source_type": "manual_eval", "title": "t", "observed_at": "2026-09-03"}],
    )
    ranked = rank_products(user, [product])
    assert ranked[0].id == "p"
    assert ranked[0].fit > 0.5
    assert ranked[0].positive_factors
    assert ranked[0].last_evaluated_at == "2026-09-03"


def test_capability_filter_excludes_unmatched_products():
    user = build_user_vector(
        score_metrics(
            AssessmentSession(
                session_id="x",
                events=[{"event_type": "requested_code", "scenario_id": "s", "strength": 1.0}],
            )
        )
    )
    keep = ProductRecord(
        id="keep",
        name="Keep",
        provider="X",
        category="ide",
        description="",
        capabilities=["coding"],
        fit_vector={"code_comfort": 1.0},
        last_evaluated_at="2026-09-03",
        registry_version="test",
        evidence=[{"source_type": "manual_eval", "title": "t", "observed_at": "2026-09-03"}],
    )
    drop = ProductRecord(
        id="drop",
        name="Drop",
        provider="X",
        category="writing",
        description="",
        capabilities=["writing"],
        fit_vector={"code_comfort": 1.0},
        last_evaluated_at="2026-09-03",
        registry_version="test",
        evidence=[{"source_type": "manual_eval", "title": "t", "observed_at": "2026-09-03"}],
    )
    ranked = rank_products(user, [keep, drop], filters=FitFilters(required_capabilities=["coding"]))
    assert [r.id for r in ranked] == ["keep"]


def test_free_text_classifier_preserves_source():
    events = classify_free_text("Compare the sources and cite evidence before you recommend.", "s", "1")
    types = {e.event_type for e in events}
    assert "requested_comparison" in types
    assert "requested_sources" in types
    assert all(e.source_text for e in events)


def test_persona_is_not_psychological():
    user = build_user_vector(
        score_metrics(
            AssessmentSession(
                session_id="x",
                events=[{"event_type": "requested_evidence", "scenario_id": "s", "strength": 1.0}],
            )
        )
    )
    persona = generate_persona(user)
    blob = " ".join(str(v) for v in persona.values()).lower()
    assert "mbti" not in blob
    assert "psychological" in persona["disclaimer"].lower() or "not psychological" in persona["disclaimer"].lower()
    assert persona["interaction_rules"]
    assert persona["decision_rules"] or persona["response_rules"]


def test_exports_cover_required_targets():
    persona = generate_persona(
        build_user_vector(
            score_metrics(
                AssessmentSession(
                    session_id="x",
                    events=[{"event_type": "requested_evidence", "scenario_id": "s", "strength": 1.0}],
                )
            )
        )
    )
    for target, filename in [
        ("generic", "persona.md"),
        ("claude", "CLAUDE.md"),
        ("agents", "AGENTS.md"),
        ("cursor", ".cursor/rules/fit.mdc"),
        ("chatgpt", "chatgpt-instructions.md"),
        ("gemini", "gemini-instructions.md"),
        ("profile", "PROFILE.md"),
        ("routing", "model-routing.json"),
        ("json", "ai-fit-profile.json"),
    ]:
        name, body = export_persona(persona, target)
        assert name == filename
        assert body
    from aifit.engine import score_session
    from aifit.exports import export_pack_zip

    packed_name, packed = export_pack_zip(score_session(AssessmentSession(session_id="x", events=[{"event_type": "requested_evidence", "scenario_id": "s", "strength": 1.0}])))
    assert packed_name == "ai-profile.zip"
    assert packed[:2] == b"PK"


def test_sample_session_scores():
    session = AssessmentSession.model_validate_json(Path("examples/sample_session.json").read_text())
    result = score_session(session)
    assert result["metrics"]
    assert result["products"]
    assert result["models"]
    assert result["persona"]
    assert result["workstyle"]["label"] == "Careful Checker"
    assert result["persona"]["label"] == "Careful Building Partner"
    assert result["workstyle"]["maturity"]["score"] >= 0
    assert result["workstyle"]["narrative"]
    assert result["workstyle"]["why"]
    assert result["install_guides"]
    assert "FIT" in result["share_card"]
    assert result["operating_stack"]
    assert result["model_routing"]
    assert result["workflow"]
    assert result["instructions"]
    assert result["primary_stack"]["slots"]
    assert "disclaimer" in result


def test_eight_scenarios_have_multiple_opportunities():
    scenarios = load_scenarios()
    assert len(scenarios) == 8
    for scenario in scenarios:
        assert len(scenario.turns) >= 3
        for turn in scenario.turns:
            assert len(turn.choices) >= 2


def test_registry_valid():
    errors = registry_errors()
    assert errors["products"] == []
    assert errors["models"] == []


def test_api_health_and_score():
    from services.api.main import app

    client = TestClient(app)
    assert client.get("/health").json()["ok"] is True
    created = client.post("/v1/sessions").json()
    session_id = created["session_id"]
    add = client.post(
        f"/v1/sessions/{session_id}/events",
        json={
            "scenario_id": "launch-risk",
            "turn_id": "lr-1",
            "events": [{"event_type": "requested_evidence", "scenario_id": "launch-risk", "strength": 1.0}],
            "free_text": "cite sources",
        },
    )
    assert add.status_code == 200
    scored = client.post(f"/v1/sessions/{session_id}/score")
    assert scored.status_code == 200
    body = scored.json()
    assert body["products"]
    assert body["persona"]
    products = client.get("/v1/registry/products").json()
    models = client.get("/v1/registry/models").json()
    assert products and models
    assert all("last_evaluated_at" in p for p in products)
    exported = client.post("/v1/export/claude", json={"persona": body["persona"]})
    assert exported.status_code == 200
    assert "CLAUDE.md" in exported.json()["filename"]
    packed = client.post("/v1/export/pack", json={"persona": body["persona"], "result": body})
    assert packed.status_code == 200
    assert packed.json()["encoding"] == "base64"
    assert packed.json()["filename"] == "ai-profile.zip"
    deleted = client.delete(f"/v1/sessions/{session_id}")
    assert deleted.json()["deleted"] is True


def test_major_metrics_have_two_scenario_opportunities():
    from collections import defaultdict

    from aifit.config import EVENT_TO_METRICS

    hits: dict[str, set[str]] = defaultdict(set)
    for scenario in load_scenarios():
        for turn in scenario.turns:
            for choice in turn.choices:
                for event in choice.events:
                    for metric in EVENT_TO_METRICS.get(event.event_type, ()):
                        hits[metric].add(scenario.id)
    majors = set(EVENT_TO_METRICS.values())
    flattened = {metric for group in majors for metric in group}
    missing = [metric for metric in flattened if len(hits.get(metric, set())) < 2]
    assert missing == [], f"metrics without two scenario opportunities: {missing}"


def test_registry_covers_pack_categories_and_workloads():
    from aifit.config import MODEL_WORKLOADS
    from aifit.registry import load_models, load_products

    products = load_products("data/registry/products.json")
    models = load_models("data/registry/models.json")
    required_categories = {
        "general_assistant",
        "research",
        "coding_agent",
        "ide",
        "automation",
        "knowledge",
        "writing",
        "image",
        "video",
        "presentation",
        "design",
        "data_analysis",
        "enterprise_search",
        "local_open_source",
    }
    assert required_categories <= {p.category for p in products}
    for workload in MODEL_WORKLOADS:
        assert any(workload in model.workload_scores for model in models), workload


def test_local_only_filter_drops_cloud_products():
    session = AssessmentSession.model_validate_json(Path("examples/sample_session.json").read_text())
    result = score_session(session, filters=FitFilters(local_only=True))
    from aifit.registry import load_products

    by_id = {p.id: p for p in load_products("data/registry/products.json")}
    assert result["products"]
    for rec in result["products"]:
        deployment = set(by_id[rec["id"]].deployment)
        assert deployment & {"local", "self_hosted", "on_prem"}


def test_api_demo_share_feedback_freshness_and_scenarios():
    from services.api.main import FEEDBACK, app

    client = TestClient(app)
    demo = client.post("/v1/sessions/demo")
    assert demo.status_code == 200
    session_id = demo.json()["session_id"]
    scored = demo.json()["result"]
    assert scored["products_by_category"]
    assert scored["primary_stack"]["slots"]
    shared = client.post(f"/v1/sessions/{session_id}/share")
    assert shared.status_code == 200
    share_id = shared.json()["share_id"]
    snapshot = client.get(f"/v1/share/{share_id}")
    assert snapshot.status_code == 200
    assert snapshot.json()["persona"]
    filtered = client.post(
        f"/v1/sessions/{session_id}/score",
        json={"filters": {"local_only": True}},
    )
    assert filtered.status_code == 200
    feedback = client.post("/v1/feedback", json={"session_id": session_id, "rating": 5, "comment": "useful"})
    assert feedback.json()["ok"] is True
    assert FEEDBACK
    freshness = client.get("/v1/registry/freshness")
    assert "needs_review" in freshness.json()
    classified = client.post(
        "/v1/classify",
        json={"text": "compare sources and automate the local workflow", "scenario_id": "launch-risk", "turn_id": "lr-1"},
    )
    types = {row["event_type"] for row in classified.json()["events"]}
    assert "requested_comparison" in types
    analytics = client.get("/v1/analytics/summary")
    assert analytics.json()["event_count"] >= 1
    exported = client.get(f"/v1/sessions/{session_id}/export")
    assert exported.status_code == 200

    scenarios = client.get("/v1/scenarios").json()
    assert len(scenarios) == 8
    walk = client.post("/v1/sessions").json()["session_id"]
    for scenario in scenarios:
        for turn in scenario["turns"]:
            choice = turn["choices"][0]
            added = client.post(
                f"/v1/sessions/{walk}/events",
                json={
                    "scenario_id": scenario["id"],
                    "turn_id": turn["id"],
                    "events": choice["events"],
                    "free_text": "compare sources",
                },
            )
            assert added.status_code == 200
    walked = client.post(f"/v1/sessions/{walk}/score")
    assert walked.status_code == 200
    body = walked.json()
    assert body["metrics"]
    assert body["persona"]["disclaimer"]
    assert client.delete(f"/v1/sessions/{walk}").json()["deleted"] is True


def test_stateless_score_endpoint_accepts_full_session():
    from services.api.main import app

    client = TestClient(app)
    body = {
        "session_id": "stateless-1",
        "events": [{"event_type": "requested_evidence", "scenario_id": "launch-risk", "strength": 1.0}],
        "filters": {"local_only": False},
    }
    scored = client.post("/v1/score", json=body)
    assert scored.status_code == 200
    assert scored.json()["persona"]


def test_different_interaction_styles_get_different_profiles():
    """Two people with similar tooling but different habits must not get one answer."""
    verifier = score_session(
        AssessmentSession.model_validate_json(Path("examples/sample_session.json").read_text())
    )
    builder = score_session(
        AssessmentSession.model_validate_json(Path("examples/code_heavy_session.json").read_text())
    )
    assert verifier["workstyle"]["label"] != builder["workstyle"]["label"]
    assert verifier["workstyle"]["narrative"] != builder["workstyle"]["narrative"]
    assert verifier["persona"]["label"] != builder["persona"]["label"]


def test_label_needs_repeat_observations_not_one_strong_answer():
    from aifit.profile import workstyle_label

    values = {"evidence_seeking": 0.9, "autonomy_preference": 0.8}
    assert workstyle_label(values, {"evidence_seeking": 0.9}) == "Careful Checker"
    assert workstyle_label(values, {"evidence_seeking": 0.2}) != "Careful Checker"


def test_adaptive_signal_waits_then_stops():
    from aifit.adaptive import diagnostic_signal
    from aifit.models import AssessmentSession

    thin = AssessmentSession(
        session_id="thin",
        events=[{"event_type": "requested_evidence", "scenario_id": "launch-risk", "strength": 1.0}],
    )
    early = diagnostic_signal(thin)
    assert early["ready"] is False
    assert early["next_scenario_id"]

    session = AssessmentSession.model_validate_json(Path("examples/sample_session.json").read_text())
    ready = diagnostic_signal(session)
    assert ready["ready"] is True
    assert ready["scenarios_completed"] >= 4


def test_api_signal_endpoint():
    from services.api.main import app

    client = TestClient(app)
    thin = client.post(
        "/v1/signal",
        json={
            "session_id": "sig-1",
            "events": [{"event_type": "requested_evidence", "scenario_id": "launch-risk", "strength": 1.0}],
        },
    )
    assert thin.status_code == 200
    assert thin.json()["ready"] is False


