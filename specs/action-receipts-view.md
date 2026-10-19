# action-receipts-view

**Status:** APPROVED
**Approved by:** repository owner (Prompt 0 scope approval, PR-4; 2026-10-19)
**Date:** 2026-10-19

## Problem

`@ark/guard` (PR-3) writes `action_receipts`, but no one can see them. Control
shows `actions` with a sender-asserted `approvedBy`, which reads like
authorization and is not.

## Outcome

A signed-in Control user can open one page and see, for their org only, every
protected action ARK decided on: what was requested, the policy decision, what
actually executed, and how much of that is verified versus sender-reported.

## Acceptance criteria

1. **Route and nav.** A `/actions` route in `apps/control`, reachable from the
   nav as "Actions". It uses `requireOrg()` and org-scoped server reads through
   `@ark/db`. There are no client-side fetches of other orgs' data.
2. **Table.** Each receipt shows:
   - time, agent, tool and action, and resource (type and id);
   - amount and currency;
   - the policy id and version;
   - decision (`allow`, `deny`, `pending approval`, `unknown`);
   - execution status (`completed`, `not attempted`, `failed`, `outcome unknown`);
   - the correlation id (decision id, and the trace id when present);
   - a "simulation" badge for demo tool ids.

   Display rules:
   - "Pending approval" is never rendered as approved.
   - When a sender-reported approval was ignored, the row says so in words.
   - A missing execution status renders as "unknown", never as success.
3. **Summary tiles.** Counts by decision and by execution status, each with a
   `BasisTag` of `measured` and n = receipts, sourced "decided and recorded by
   @ark/guard". Colour follows provenance. Denied and blocked counts are neutral
   facts, not alarms.
4. **The existing Budgets "Unapproved actions" panel** gets one line saying
   `approvedBy` there is sender-reported, with a link to `/actions` for verified
   decisions.
5. **States.**
   - **Empty:** explains how to emit receipts and links to
     `packages/guard/README.md`.
   - **Errors:** handled by an error boundary with a readable message.
   - **Layout:** works at 390px with no horizontal page scroll; the table becomes
     stacked cards (`CardTable` from `@ark/ui`).
   - **Accessibility:** keyboard navigable, with correct header alignment.
6. **Data and tests.**
   - The seed adds synthetic receipts for Demo Co by running the PR-3 demo
     scenarios through `guardTool` against the seed database, not by hand-written
     rows. Northwind stays empty.
   - A db test proves org isolation of the receipts query.

## How this will be proved

- **Artefact:** screenshots
- **Measured by:** Playwright against `next start`, signed in as Demo Co,
  capturing `/actions` and `/budgets` at 1280 and 390, plus `/actions` as
  Northwind.
  - **Before:** `/actions` returns 404.
  - **After:** the screenshots above, with the same seed and viewports.
- **Conditions:** fresh `npm run db:bootstrap` database, production build.

## Out of scope

- Approving actions from the UI.
- An approval inbox.
- RBAC.
- Charts.
- Changes to other pages beyond the one Budgets line.

## Risk

A new authenticated read path. The reviewer checks org scoping and that no
display state overclaims.

- **Rollback:** revert.
