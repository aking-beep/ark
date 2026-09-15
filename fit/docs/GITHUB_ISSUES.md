# GitHub launch issues (from pack)

Create these on the public repo. Do not treat them as already implemented
unless the matching code exists in this tree.

## P0 — must ship with v0.1

- [x] Core metric engine + scoring
- [x] Product registry + model registry (seed, illustrative)
- [x] Scenario-based assessment UI (24 rounds / 8 scenarios × 3)
- [x] Results: persona, stacks, ranked products, ranked models
- [x] Privacy page + in-memory session delete
- [x] Shareable results (no raw prompts)
- [x] Feedback on recommendations
- [x] Export persona JSON / Markdown
- [x] Freshness report CLI + API
- [x] Definition of Done checklist

## P1 — first public week

- [ ] Replace illustrative registry evidence with sourced, dated citations
- [ ] Human review of every product row (`docs/REGISTRY_SEED_REVIEW.md`)
- [ ] Optional LLM classifier behind `AIFIT_LLM_CLASSIFIER` (adapter exists; needs a live endpoint to exercise)
- [ ] Playwright CI in GitHub Actions
- [ ] Public changelog + versioned scoring notes

## P2 — after first users

- [x] Durable session store — browser localStorage + filesystem or Upstash/Vercel KV; Postgres still optional later
- [ ] Accounts / saved history — **explicitly after v0.1**
- [ ] Hiring / screening mode — **out of scope forever unless the thesis changes**
- [ ] Personality / IQ instruments — **forbidden**

## Issue templates (copy into GitHub)

### Registry evidence stale
**Title:** Refresh evidence for `{product_id}`
**Body:** Evidence date is older than 90 days. Update `evidence_url`, `evidence_date`, and `evidence_notes`. Do not invent claims.

### Metric coverage gap
**Title:** Scenario does not exercise `{metric}`
**Body:** Add or adjust a scenario so this metric has ≥2 opportunities.

### Ranker disagreement
**Title:** Recommendation looks wrong for scenario `{id}`
**Body:** Attach the persona JSON and expected stack. Do not ask an LLM to “just pick a better tool.”
