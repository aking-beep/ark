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

## Metric score

Implemented in `packages/core/src/myai/metrics.py`. Each interaction event maps to one or
more metrics through `EVENT_TO_METRICS` (`config.py`).

A metric score is the share of opportunities the person took, not the average strength of
the times they took it. (Averaging only the observed events made one click look identical to
a habit: anyone who picked an option once scored ~1.0.)

For metric `m`:

```text
played         = scenarios with at least one event in the session
opportunities  = { s in played : a choice in scenario s emits an event for m }
               ∪ { s : an event for m was observed in s }      # e.g. free text
hit[s]         = clamp( max strength of m events in s
                        - max strength of opposing events in s, 0, 1 )
score          = Σ hit[s] / |opportunities|
```

- A scenario counts once, however many turns offered `m`; repeating a choice inside one
  scenario does not inflate the score.
- An opportunity that was offered and declined contributes `0`, so it lowers the score.
- Opposing pairs (`OPPOSING_METRICS` in `config.py`) net inside a scenario:
  `speed_preference ↔ depth_preference`, `local_control_preference ↔ cloud_preference`,
  `budget_sensitivity ↔ quality_preference` (`chose_lower_cost` vs `chose_best_quality`, and so on).
- The score is monotonic: within the same played scenarios, adding a hit or raising its
  strength never lowers it, and adding an opposing choice never raises it
  (`tests/test_metrics.py`).

Metrics only appear in the vector when the session had at least one opportunity for them.

## Metric confidence

Confidence is separate from score.

```text
observations          = Σ over opportunities of
                          (events for m or its opposite in s)  or 1 if none (a declined opportunity)
observation_confidence = min(1, observations / target_observations[m])
scenario_bonus         = min(1, |opportunities| / HIGH_CONFIDENCE_SCENARIO_COUNT)   # = 2
confidence             = min(1, 0.7 * observation_confidence + 0.3 * scenario_bonus)
```

`target_observations` defaults to 4 and is set per metric in `TARGET_OBSERVATIONS`
(`config.py`, 3–5). Labels in `profile.py` / `persona.py` require both a high score and
`confidence >= 0.45` (`MIN_LABEL_CONFIDENCE`).

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
