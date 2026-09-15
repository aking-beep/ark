# Scoring Specification

## Score range

All normalized preference and capability scores use `0.0 - 1.0`.

## User Fit Vector

Example:

```json
{
  "evidence_seeking": 0.88,
  "comparison_preference": 0.78,
  "iteration_preference": 0.91,
  "autonomy_preference": 0.62,
  "structure_preference": 0.84,
  "action_orientation": 0.89,
  "multimodal_preference": 0.52,
  "code_comfort": 0.77,
  "automation_appetite": 0.81,
  "local_control_preference": 0.30,
  "budget_sensitivity": 0.42
}
```

## Metric confidence

Confidence is separate from score.

A simple v0.1 confidence function:

```text
confidence = min(1.0, observations / target_observations)
```

Target observations default to 4 but may vary by metric.

## Product fit

Each product entry has a fit vector using the same compatible dimensions plus capability flags.

Initial fit calculation:

```text
weighted_distance = Σ weight[d] * abs(user[d] - product_preference_fit[d])
fit = 1 - weighted_distance / Σ weights
```

Then apply:
- capability requirement filters
- category relevance
- budget constraint
- local/cloud requirement
- technical-level compatibility
- confidence penalty
- freshness penalty

## Freshness penalty

Registry records older than a configured threshold should lose confidence, not automatically become "bad."

Example:
- <= 30 days: 1.00
- 31-90 days: 0.95
- 91-180 days: 0.85
- >180 days: 0.70

## Model fit

Model fit is workload-specific.

A user does not receive one globally "best model."

Example:

```json
{
  "deep_reasoning": [{"model":"...", "fit":0.91}],
  "coding": [{"model":"...", "fit":0.93}],
  "multimodal": [{"model":"...", "fit":0.88}]
}
```

## Explainability

Every recommendation must expose:
- base fit
- strongest positive factors
- strongest negative factors
- relevant user metrics
- registry freshness
- confidence
- capability requirements satisfied

## Prevent bogus precision

UI may show whole-number percentages for readability, but internal documentation must clearly say the score is a normalized fit score, not a scientifically validated probability.
