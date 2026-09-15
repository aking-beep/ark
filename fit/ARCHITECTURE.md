# Architecture

## Bounded contexts

### 1. Assessment
Owns scenarios, turns, choices, free-text inputs, timing, and interaction events.

### 2. InteractionBench
Converts interaction events into normalized behavioral metrics.

### 3. Registry
Stores product/model metadata, capability vectors, supported workloads, evidence provenance, version, and last evaluation date.

### 4. Fit Engine
Matches a user fit vector against product and model capability/preference vectors.

### 5. Persona Generator
Transforms behavioral preferences into portable AI working instructions.

### 6. Export Layer
Outputs platform-specific configuration artifacts.

## Core data flow

```text
Scenario definition
      ↓
Session responses
      ↓
Raw interaction events
      ↓
Normalized interaction events
      ↓
Behavioral metrics + evidence
      ↓
User fit vector
      ↓
Registry matching
      ↓
Recommendations
      ↓
Persona
      ↓
Exports
```

## Hard architectural rules

1. Product recommendations must not be directly produced by an LLM with no scoring layer.
2. Every recommendation needs an inspectable score breakdown.
3. Behavioral metrics must be tied to observable assessment behavior.
4. Model/product claims must include a registry `last_evaluated_at` field.
5. Product registry and model registry are distinct.
6. Vendor names may change without changing assessment logic.
7. The system must support multiple tools from the same vendor.
8. A user can receive different recommendations for research, build, coding, design, automation, and general work.
9. The LLM layer may classify ambiguous text, but deterministic features remain first-class.
10. Do not infer protected or sensitive personal attributes.

## Suggested services

```text
apps/web
  Next.js assessment + results UI

services/api
  FastAPI endpoints

packages/core
  Python scoring + registry + persona engine

data/registry
  product and model definitions

data/scenarios
  game scenarios

evals
  model/product benchmark inputs and expected dimensions
```

## Later-stage architecture

When product usage grows:

- PostgreSQL for sessions and profile persistence
- Redis for transient assessment state
- object storage for benchmark artifacts
- scheduled registry refresh jobs
- isolated benchmark runners
- feature flags for experimental recommendation logic
