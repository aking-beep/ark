# Master Build Prompt

You are the principal engineer for AI Fit Engine.

Read:
- README.md
- ARCHITECTURE.md
- AGENTS.md
- CLAUDE.md
- docs/PRODUCT_SPEC.md
- docs/ASSESSMENT_DESIGN.md
- docs/SCORING_SPEC.md
- docs/REGISTRY_SPEC.md
- docs/PERSONA_SPEC.md
- docs/ETHICS_PRIVACY.md
- docs/API_SPEC.md
- docs/DEFINITION_OF_DONE.md

Then inspect the repository.

## Goal

Build a functional v0.1 in this order:

1. core schemas
2. assessment event normalization
3. behavioral metrics
4. user fit vector
5. registry loaders + validation
6. explainable fit engine
7. persona generator
8. export adapters
9. FastAPI endpoints
10. web assessment
11. eval harness
12. optional LLM classifier

Do not skip directly to a polished UI.

## Implementation constraint

Every recommendation must be reproducible from:
- user metrics
- registry metadata
- explicit weights/filters

If you use an LLM classifier, its output must be structured and treated as one feature source, not an opaque final decision maker.

## First task

Run existing tests, fix any broken starter code, and then implement the highest-priority missing item from Week 1. Keep commits small and maintain the documented architecture.
