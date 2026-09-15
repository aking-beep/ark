"""Registry freshness reporting. Old records lose confidence, not capability."""

from __future__ import annotations

from datetime import date

from .fit import _freshness_factor
from .models import ModelRecord, ProductRecord


def describe_age(last_evaluated_at: str) -> dict:
    try:
        age = (date.today() - date.fromisoformat(last_evaluated_at)).days
    except Exception:
        age = None
    factor = _freshness_factor(last_evaluated_at)
    if age is None:
        band = "unknown"
    elif age <= 30:
        band = "current"
    elif age <= 90:
        band = "aging"
    elif age <= 180:
        band = "stale"
    else:
        band = "expired_confidence"
    return {"last_evaluated_at": last_evaluated_at, "age_days": age, "factor": factor, "band": band}


def freshness_report(products: list[ProductRecord], models: list[ModelRecord]) -> dict:
    product_rows = [
        {"id": p.id, "name": p.name, "category": p.category, **describe_age(p.last_evaluated_at)}
        for p in products
    ]
    model_rows = [
        {"id": m.id, "name": m.name, "family": m.family, **describe_age(m.last_evaluated_at)}
        for m in models
    ]
    stale = [r for r in product_rows + model_rows if r["band"] in {"stale", "expired_confidence", "unknown"}]
    return {
        "products": product_rows,
        "models": model_rows,
        "needs_review": stale,
        "policy": "Records older than the freshness threshold lose confidence rather than being marked as bad.",
    }
