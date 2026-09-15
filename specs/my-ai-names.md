# my-ai-names

**Status:** APPROVED
**Approved by:** repository owner (rename Fit → MY AI, AIFit for teams → MY AI for teams)
**Date:** 2026-09-15

## Problem

The consumer product still brands as Fit and the teams product as AIFit for teams. The owner wants the public names **MY AI** and **MY AI for teams**. Layouts, engines, and the products staying separate do not change.

## Outcome

A visitor to the consumer app sees **MY AI**. A visitor to the teams app sees **MY AI for teams**. Control copy that names the teams estimator uses that name too. An operator installing or running the consumer scoring engine sees **MY AI** in the directory, package, scripts, and API errors — not Fit.

## Acceptance criteria

1. Consumer chrome wordmark, document title, Open Graph site name, primary CTA, and body copy that named the product “Fit” now say **MY AI**. The landing CTA is “Find MY AI”. The results “Fit score” label is “MY AI score”.
2. Business chrome wordmark, kicker, and page titles that said “AIFit” / “AIFit for teams” now say **MY AI** / **MY AI for teams**.
3. Control user-visible copy that said “AIFit” (dashboard empty state, calibration page, workload drift) now says **MY AI for teams**.
4. Current product docs the visitor/operator reads for names — README product table and install/run commands, `docs/prd/aifit-consumer.md` and `docs/prd/aifit-business.md` titles/one-liners, `docs/05-hosting.md` surface table, `docs/06-aifit-consumer.md` opening — use the new names.
5. Consumer Playwright specs that assert the old brand strings are updated. Products still do not cross-link.
6. The consumer scoring engine is named MY AI for operators: directory `my-ai/`, Python package `myai`, npm scripts `setup:my-ai` / `dev:my-ai-api` / `test:my-ai`, Docker `COPY`/`pip install -e ./my-ai`, proxy errors “MY AI API …”, env `MYAI_ROOT`. HTTP `/v1/*` routes stay so existing clients keep working. `@ark/consumer` and historical ADRs stay.

## How this will be proved

- **Artefact:** HTML dumps and 1440×900 screenshots of consumer `/` and business `/`, plus grep of titles/wordmarks.
- **Measured by:**
  - Before: consumer HTML contains “Fit —” / “Find my fit”; business HTML contains “AIFit for teams”.
  - After: consumer contains “MY AI” and “Find MY AI”, not “Find my fit”; business contains “MY AI for teams”, not “AIFit for teams”.
- **Conditions:** consumer `:3000`, business `:3001`, same viewport.

## Out of scope

- New logos or OG artwork (`og.png` file can keep pixels; alt text updates).
- Cross-linking the two products.
- Changing scoring, layout systems (cream vs dark), or ARK Control’s own name.
- Rewriting historical ADRs, thesis, or past evidence directories.
- Renaming npm workspace `@ark/consumer` or HTTP paths under `/v1`.

## Risk

None beyond copy. No new dependency.

- **Rollback:** revert the branch.
