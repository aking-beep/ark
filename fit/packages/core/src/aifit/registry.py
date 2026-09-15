from __future__ import annotations

import json
from pathlib import Path

from .models import ModelRecord, ProductRecord

REQUIRED_PRODUCT_FIELDS = (
    "id",
    "name",
    "provider",
    "category",
    "description",
    "status",
    "homepage",
    "pricing_tier",
    "technical_level",
    "deployment",
    "modalities",
    "capabilities",
    "integrations",
    "fit_vector",
    "underlying_models",
    "evidence",
    "last_evaluated_at",
    "registry_version",
)

REQUIRED_MODEL_FIELDS = (
    "id",
    "name",
    "provider",
    "family",
    "availability",
    "modalities",
    "workload_scores",
    "context_notes",
    "cost_notes",
    "evidence",
    "last_evaluated_at",
    "registry_version",
)


def load_products(path: str | Path) -> list[ProductRecord]:
    data = json.loads(Path(path).read_text())
    return [ProductRecord.model_validate(x) for x in data]


def load_models(path: str | Path) -> list[ModelRecord]:
    data = json.loads(Path(path).read_text())
    return [ModelRecord.model_validate(x) for x in data]


def _validate_evidence(item_id: str, evidence: list) -> list[str]:
    errors: list[str] = []
    if not evidence:
        errors.append(f"{item_id}: missing evidence")
        return errors
    for row in evidence:
        observed = getattr(row, "observed_at", None)
        if not observed:
            errors.append(f"{item_id}: evidence missing observed_at")
        if not getattr(row, "title", None):
            errors.append(f"{item_id}: evidence missing title")
        if not getattr(row, "source_type", None):
            errors.append(f"{item_id}: evidence missing source_type")
    return errors


def validate_products(products: list[ProductRecord]) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for product in products:
        if product.id in seen:
            errors.append(f"duplicate product id: {product.id}")
        seen.add(product.id)
        for field in REQUIRED_PRODUCT_FIELDS:
            if getattr(product, field, None) in (None, "", []):
                if field in {"homepage", "integrations", "underlying_models"}:
                    continue
                errors.append(f"{product.id}: missing {field}")
        if not product.last_evaluated_at:
            errors.append(f"{product.id}: missing last_evaluated_at")
        errors.extend(_validate_evidence(product.id, product.evidence))
    return errors


def validate_models(models: list[ModelRecord]) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for model in models:
        if model.id in seen:
            errors.append(f"duplicate model id: {model.id}")
        seen.add(model.id)
        for field in REQUIRED_MODEL_FIELDS:
            if getattr(model, field, None) in (None, "", []):
                if field in {"context_notes", "cost_notes"}:
                    continue
                errors.append(f"{model.id}: missing {field}")
        if not model.last_evaluated_at:
            errors.append(f"{model.id}: missing last_evaluated_at")
        errors.extend(_validate_evidence(model.id, model.evidence))
    return errors
