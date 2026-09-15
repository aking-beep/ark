# Product and Model Registry Specification

## Product Registry

A **product** is the user-facing tool/service: Claude, ChatGPT, Cursor, Perplexity, Fable, etc.

Required fields:

```yaml
id:
name:
provider:
category:
description:
status:
homepage:
pricing_tier:
technical_level:
deployment:
modalities:
capabilities:
integrations:
fit_vector:
underlying_models:
evidence:
last_evaluated_at:
registry_version:
```

## Model Registry

A **model** is the underlying model family/version, independent of UI product.

Required fields:

```yaml
id:
name:
provider:
family:
availability:
modalities:
workload_scores:
context_notes:
cost_notes:
evidence:
last_evaluated_at:
registry_version:
```

## Why separate them

A product can:
- expose multiple models
- include workflow features beyond the model
- add browsing/tools/memory/collaboration
- change underlying models
- provide a different experience from API access

Therefore:
`product != model`.

## Evidence format

```json
{
  "source_type": "official|benchmark|manual_eval|third_party",
  "title": "...",
  "url": "...",
  "observed_at": "YYYY-MM-DD",
  "notes": "..."
}
```

## Seed data rule

The included seed registry is **illustrative**. Before public launch, every current vendor capability and model entry must be independently re-evaluated.

## Adding new tools

Adding a product should not require application code changes.

1. add registry record
2. validate schema
3. add/evaluate capability evidence
4. run fit regression tests
5. publish registry version

This is what allows the system to scale as the AI market changes.
