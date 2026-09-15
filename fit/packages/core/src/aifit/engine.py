from __future__ import annotations

import os
from pathlib import Path

from .config import MODEL_WORKLOADS
from .adaptive import diagnostic_signal
from .classifier import classify_text
from .fit import build_stacks, rank_models_by_workload, rank_products
from .metrics import build_user_vector, score_metrics
from .models import AssessmentSession, FitFilters, InteractionEvent
from .persona import generate_persona
from .profile import (
    build_model_router,
    build_operating_stack,
    build_workflow,
    build_workstyle,
    default_instructions,
    install_guides,
    share_card_text,
)
from .freshness import freshness_report
from .registry import load_models, load_products, validate_models, validate_products


def repo_root() -> Path:
    env = os.environ.get("AIFIT_ROOT")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        if (parent / "data/registry/products.json").exists():
            return parent
    return here.parents[4]


def data_root(root: Path | None = None) -> Path:
    return (root or repo_root()) / "data"


def score_session(
    session: AssessmentSession,
    *,
    root: Path | None = None,
    filters: FitFilters | None = None,
) -> dict:
    metrics = score_metrics(session)
    user = build_user_vector(metrics)
    base = data_root(root)
    products = load_products(base / "registry/products.json")
    models = load_models(base / "registry/models.json")
    product_recs = rank_products(user, products, filters=filters)
    model_recs = rank_models_by_workload(models)
    primary, alternative = build_stacks(user, product_recs)
    persona = generate_persona(user)
    workstyle = build_workstyle(user, metrics)
    operating_stack = build_operating_stack(product_recs, user.values)
    payload = {
        "metrics": [m.model_dump() for m in metrics],
        "user_vector": user.model_dump(),
        "products": [x.model_dump() for x in product_recs[:12]],
        "products_by_category": _by_category(product_recs),
        "models": {w: [x.model_dump() for x in model_recs[w][:5]] for w in MODEL_WORKLOADS if model_recs[w]},
        "primary_stack": primary.model_dump(),
        "alternative_stack": alternative.model_dump(),
        "operating_stack": operating_stack,
        "model_routing": build_model_router(model_recs),
        "workflow": build_workflow(user.values),
        "workstyle": workstyle,
        "persona": persona,
        "instructions": default_instructions(persona),
        "install_guides": install_guides(),
        "diagnostic": diagnostic_signal(session),
        "freshness": freshness_report(products, models),
        "privacy": {
            "mode": "anonymous",
            "stores_name": False,
            "stores_employer": False,
            "retention": "In-memory session until delete or process restart. Share snapshots contain scores only.",
        },
        "disclaimer": "Fit scores are normalized similarity scores, not scientifically validated probabilities.",
    }
    payload["share_card"] = share_card_text(payload)
    return payload


def normalize_free_text(text: str, scenario_id: str, turn_id: str | None = None) -> list[InteractionEvent]:
    return classify_text(text, scenario_id, turn_id)


def registry_errors(root: Path | None = None) -> dict[str, list[str]]:
    base = data_root(root)
    products = load_products(base / "registry/products.json")
    models = load_models(base / "registry/models.json")
    return {
        "products": validate_products(products),
        "models": validate_models(models),
    }


def _by_category(recs) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for rec in recs:
        key = rec.category or "other"
        grouped.setdefault(key, [])
        if len(grouped[key]) < 3:
            grouped[key].append(rec.model_dump())
    return grouped
