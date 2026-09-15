from __future__ import annotations

from datetime import date

from .config import DEFAULT_WEIGHTS, MODEL_WORKLOADS, PRICING_RANK
from .models import (
    AIStack,
    FitFilters,
    ModelRecord,
    ProductRecord,
    Recommendation,
    StackSlot,
    UserFitVector,
)


def _freshness_factor(last_evaluated_at: str) -> float:
    try:
        evaluated = date.fromisoformat(last_evaluated_at)
        age = (date.today() - evaluated).days
    except Exception:
        return 0.7
    if age <= 30:
        return 1.0
    if age <= 90:
        return 0.95
    if age <= 180:
        return 0.85
    return 0.70


def _passes_filters(product: ProductRecord, filters: FitFilters | None) -> bool:
    if not filters:
        return True
    if filters.required_capabilities:
        missing = set(filters.required_capabilities) - set(product.capabilities)
        if missing:
            return False
    if filters.categories and product.category not in filters.categories:
        return False
    if filters.max_pricing_tier:
        cap = PRICING_RANK.get(filters.max_pricing_tier, 2)
        if PRICING_RANK.get(product.pricing_tier, 2) > cap:
            return False
    if filters.deployment:
        if not set(filters.deployment) & set(product.deployment):
            return False
    if filters.max_technical_level is not None:
        if product.technical_level > filters.max_technical_level:
            return False
    if filters.local_only:
        local_modes = {"local", "self_hosted", "on_prem"}
        if not set(product.deployment) & local_modes:
            return False
    return True


def rank_products(
    user: UserFitVector,
    products: list[ProductRecord],
    weights: dict[str, float] | None = None,
    filters: FitFilters | None = None,
) -> list[Recommendation]:
    weights = weights or DEFAULT_WEIGHTS
    out: list[Recommendation] = []
    for product in products:
        if product.status != "active":
            continue
        if not _passes_filters(product, filters):
            continue
        comparisons: list[tuple[str, float]] = []
        total_weight = 0.0
        weighted_distance = 0.0
        confidence_values: list[float] = []

        for dim, product_value in product.fit_vector.items():
            if dim not in user.values or dim not in weights:
                continue
            w = weights[dim]
            distance = abs(user.values[dim] - product_value)
            weighted_distance += w * distance
            total_weight += w
            confidence_values.append(user.confidence.get(dim, 0.5))
            comparisons.append((dim, distance))

        if total_weight == 0:
            continue

        base_fit = max(0.0, 1.0 - weighted_distance / total_weight)
        freshness = _freshness_factor(product.last_evaluated_at)
        mean_conf = (sum(confidence_values) / len(confidence_values)) if confidence_values else 0.5
        fit = base_fit * freshness * (0.7 + 0.3 * mean_conf)
        comparisons.sort(key=lambda x: x[1])
        positives = [f"{d} aligned" for d, _ in comparisons[:3]]
        negatives = [f"{d} less aligned" for d, dist in comparisons[-2:] if dist > 0.35]

        out.append(
            Recommendation(
                id=product.id,
                name=product.name,
                fit=round(fit, 4),
                confidence=round(mean_conf * freshness, 4),
                positive_factors=positives,
                negative_factors=negatives,
                last_evaluated_at=product.last_evaluated_at,
                category=product.category,
                base_fit=round(base_fit, 4),
                freshness=round(freshness, 4),
            )
        )
    return sorted(out, key=lambda r: r.fit, reverse=True)


def rank_models_for_workload(models: list[ModelRecord], workload: str) -> list[Recommendation]:
    results: list[Recommendation] = []
    for model in models:
        if workload not in model.workload_scores:
            continue
        freshness = _freshness_factor(model.last_evaluated_at)
        score = model.workload_scores[workload] * freshness
        results.append(
            Recommendation(
                id=model.id,
                name=model.name,
                fit=round(score, 4),
                confidence=round(freshness, 4),
                positive_factors=[f"Strong registry score for {workload}"],
                negative_factors=[],
                last_evaluated_at=model.last_evaluated_at,
                category=workload,
                base_fit=round(model.workload_scores[workload], 4),
                freshness=round(freshness, 4),
            )
        )
    return sorted(results, key=lambda r: r.fit, reverse=True)


def rank_models_by_workload(models: list[ModelRecord]) -> dict[str, list[Recommendation]]:
    return {workload: rank_models_for_workload(models, workload)[:5] for workload in MODEL_WORKLOADS}


def relevant_categories(user: UserFitVector) -> list[str]:
    values = user.values
    categories = ["general_assistant"]
    if values.get("code_comfort", 0) >= 0.45:
        categories.append("ide")
        categories.append("coding_agent")
    if values.get("evidence_seeking", 0) >= 0.55:
        categories.append("research")
        categories.append("knowledge")
    if values.get("automation_appetite", 0) >= 0.55:
        categories.append("automation")
    if values.get("integration_appetite", 0) >= 0.55:
        categories.append("enterprise_search")
    if values.get("multimodal_preference", 0) >= 0.55:
        categories.extend(["writing", "image", "design", "presentation", "video"])
    if values.get("structure_preference", 0) >= 0.65 and values.get("evidence_seeking", 0) >= 0.5:
        categories.append("data_analysis")
    if values.get("local_control_preference", 0) >= 0.6:
        categories.append("local_open_source")
    # Preserve order while dropping duplicates.
    seen: set[str] = set()
    ordered: list[str] = []
    for category in categories:
        if category not in seen:
            seen.add(category)
            ordered.append(category)
    return ordered


def _pick_by_category(recs: list[Recommendation], category: str, skip_ids: set[str]) -> Recommendation | None:
    for rec in recs:
        if rec.category == category and rec.id not in skip_ids:
            return rec
    return None


def build_stacks(user: UserFitVector, recs: list[Recommendation]) -> tuple[AIStack, AIStack]:
    categories = relevant_categories(user)
    used: set[str] = set()
    primary_slots: list[StackSlot] = []
    rationale: list[str] = []
    for category in categories:
        pick = _pick_by_category(recs, category, used)
        if pick:
            used.add(pick.id)
            primary_slots.append(StackSlot(category=category, recommendation=pick))
            rationale.append(f"{pick.name} leads {category.replace('_', ' ')} for this interaction signature.")

    alt_used: set[str] = set(used)
    alt_slots: list[StackSlot] = []
    alt_rationale: list[str] = []
    for category in categories:
        pick = _pick_by_category(recs, category, alt_used)
        if pick:
            alt_used.add(pick.id)
            alt_slots.append(StackSlot(category=category, recommendation=pick))
            alt_rationale.append(f"{pick.name} is the next-best {category.replace('_', ' ')} option.")

    if not alt_slots:
        leftovers = [r for r in recs if r.id not in used][:3]
        for rec in leftovers:
            alt_slots.append(StackSlot(category=rec.category or "other", recommendation=rec))

    return (
        AIStack(name="Primary stack", slots=primary_slots, rationale=rationale),
        AIStack(name="Alternative stack", slots=alt_slots, rationale=alt_rationale),
    )
