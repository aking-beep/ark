from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

EventType = Literal[
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
]


class InteractionEvent(BaseModel):
    event_type: EventType
    scenario_id: str = ""
    turn_id: str | None = None
    strength: float = Field(default=1.0, ge=0, le=1)
    evidence: str | None = None
    source_text: str | None = None
    classifier: str = "choice"
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssessmentSession(BaseModel):
    session_id: str
    events: list[InteractionEvent] = Field(default_factory=list)


class MetricResult(BaseModel):
    name: str
    score: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    observations: int
    scenario_ids: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)


class UserFitVector(BaseModel):
    values: dict[str, float]
    confidence: dict[str, float] = Field(default_factory=dict)


class RegistryEvidence(BaseModel):
    source_type: str
    title: str
    url: str | None = None
    observed_at: str
    notes: str | None = None


class ProductRecord(BaseModel):
    id: str
    name: str
    provider: str
    category: str
    description: str
    status: str = "active"
    homepage: str | None = None
    pricing_tier: str = "unknown"
    technical_level: float = Field(default=0.5, ge=0, le=1)
    deployment: list[str] = Field(default_factory=list)
    modalities: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    integrations: list[str] = Field(default_factory=list)
    fit_vector: dict[str, float] = Field(default_factory=dict)
    underlying_models: list[str] = Field(default_factory=list)
    evidence: list[RegistryEvidence] = Field(default_factory=list)
    last_evaluated_at: str
    registry_version: str


class ModelRecord(BaseModel):
    id: str
    name: str
    provider: str
    family: str
    availability: list[str] = Field(default_factory=list)
    modalities: list[str] = Field(default_factory=list)
    workload_scores: dict[str, float] = Field(default_factory=dict)
    context_notes: str | None = None
    cost_notes: str | None = None
    evidence: list[RegistryEvidence] = Field(default_factory=list)
    last_evaluated_at: str
    registry_version: str


class Recommendation(BaseModel):
    id: str
    name: str
    fit: float
    confidence: float
    positive_factors: list[str] = Field(default_factory=list)
    negative_factors: list[str] = Field(default_factory=list)
    last_evaluated_at: str
    category: str | None = None
    base_fit: float | None = None
    freshness: float | None = None


class FitFilters(BaseModel):
    required_capabilities: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    max_pricing_tier: str | None = None
    deployment: list[str] = Field(default_factory=list)
    max_technical_level: float | None = Field(default=None, ge=0, le=1)
    local_only: bool = False


class Choice(BaseModel):
    id: str
    label: str
    events: list[InteractionEvent] = Field(default_factory=list)


class ScenarioTurn(BaseModel):
    id: str
    prompt: str
    hidden_information: str | None = None
    choices: list[Choice]
    allow_free_text: bool = True


class Scenario(BaseModel):
    id: str
    title: str
    domain: str
    setup: str
    initial_ambiguity: str | None = None
    dimensions: list[str] = Field(default_factory=list)
    rounds: int = 2
    turns: list[ScenarioTurn] = Field(default_factory=list)


class StackSlot(BaseModel):
    category: str
    recommendation: Recommendation


class AIStack(BaseModel):
    name: str
    slots: list[StackSlot]
    rationale: list[str] = Field(default_factory=list)
