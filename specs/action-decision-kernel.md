# action-decision-kernel

**Status:** APPROVED
**Approved by:** repository owner (Prompt 0 scope approval, PR-2; wedge decision "supersede ADR-0008"; 2026-10-19)
**Date:** 2026-10-19

## Problem

ARK has no way to decide whether one specific consequential action may run.
- `packages/core/src/governance/policy.ts` evaluates an Agent Manifest's posture
  (approved models, policy refs, logging).
- `enforce.ts` (from #18) gates model calls in `@ark/runtime`, and `unknown`
  passes.

Neither answers "may this agent refund $750 to order X for this org, now?" A
manifest `pass` is not authorization to move money. The founder has made this
decision the wedge, which supersedes ADR-0008.

## Outcome

A caller can hand ARK a trusted, typed description of one protected action and
get back a deterministic, side-effect-free decision of `allow`, `deny`,
`require_approval` or `unknown`. A protected action is authorized only by an
explicit `allow`.

## Acceptance criteria

1. **ADR-0009** (`docs/adr/0009-action-accountability-wedge.md`) supersedes
   ADR-0008's "what is sold" and "why they pay".
   - **Wedge:** approval and accountability for consequential AI-agent tool
     actions, enforced by an opt-in, in-process guard at a trusted tool boundary.
   - **Request path:** Control's HTTP service stays out of the request path.
   - **Observe:** becomes the supporting loop.
   - **Refusals that still bind:** no model gateway, agent framework, general APM,
     payload storage or invented ROI. The guard is not a general MCP proxy.
   - ADR-0008 gets a "Superseded in part by ADR-0009" status line. Its text is
     not erased.
   - README, `docs/00-thesis.md` and `docs/prd/ark-control.md` get one-line
     pointers to ADR-0009.
2. **Typed contracts** in `packages/core/src/governance/action.ts`, exported from
   `@ark/core`.
   - **`ActionRequest`**, built only from trusted server context:
     - `orgId` and `agentId` (verified);
     - optional `principal` (an authenticated delegating user id);
     - `tool` and `action` identifiers;
     - normalized `resource` (`type`, `id`);
     - typed `attributes` (for the demo: `amountMinor` integer and `currency`
       ISO-4217);
     - `now` (ms).
   - **`ActionPolicy`**:
     - `id`, `version`, `orgId`;
     - the `tool` and `action` it governs;
     - ordered rules, with typed comparisons on amount and currency only;
     - default effect `deny`.
   - Roles and permissions supplied by the caller are not part of the request
     type and are ignored.
3. **`decideAction(request, policies)`**:
   - **Purity:** pure. No I/O, no clock reads (uses `request.now`), no
     randomness, no LLM.
   - **Returns:**
     - `decision`: `allow`, `deny`, `require_approval` or `unknown`;
     - `decisionId`: deterministic, sha256 over policy id, version and request
       digest;
     - `policyId` and `policyVersion`;
     - `reasonCode`, from a closed enum;
     - `requestDigest`: sha256 of the canonical JSON of the normalized request;
     - `expiresAt` for `allow` and `require_approval`.
   - **Fail-closed rules:**
     - no matching policy → `unknown`;
     - a policy for another org is never matched;
     - policy invalid or failing schema → `unknown`;
     - two matching policies with conflicting effects → `deny`;
     - amount negative, non-integer or non-finite → `deny` with `invalid_amount`;
     - currency missing or mismatched → `deny`;
     - resource missing → `deny`;
     - `expectedPolicyVersion` supplied and not matching → `unknown` with
       `policy_version_mismatch`.
   - There is no fallback `allow` anywhere.
4. **Demo policy.** `DEMO_REFUND_POLICY` is exported and labelled synthetic in
   code and docs: ≤ $100 `allow`; > $100 and ≤ $1,000 `require_approval`;
   > $1,000 `deny`. A comment states these are not production defaults.
5. **Tests** (`packages/core/src/governance/action.test.ts`):
   - boundary values: 10000, 10001, 100000 and 100001 minor units;
   - missing policy, invalid policy, wrong org, conflicting policies;
   - policy version mismatch;
   - invalid amount or currency, missing resource;
   - a forged `role` or `permissions` field in the input changes nothing;
   - determinism: same input gives the same `decisionId` and digest; different
     input gives a different digest;
   - no side effects (the function is synchronous and has no dependencies on
     I/O modules).
   - Add the test file to the core `test` script.
6. **Existing behaviour unchanged.** `policy.ts`, `enforce.ts` and their tests
   are unchanged.

## How this will be proved

- **Artefact:** terminal output
- **Measured by:** `evidence/action-decision-kernel/decide-demo.mjs`, which prints
  the decision table for $75, $100, $100.01, $750, $1,000, $1,000.01, $5,000, an
  unknown tool, another org's policy, a forged role, and a version mismatch.
  - **Before:** the import fails, because no such function exists.
  - **After:** the table, with zero LLM calls.
- **Conditions:** built `@ark/core` dist, Node 22.

## Out of scope

- Executing anything.
- Persistence.
- An approval UI or approval service.
- A policy DSL.
- An authorization server.
- Changing `enforce.ts` semantics.

## Risk

Authorization logic for money movement. `agents/security-reviewer.md` must run.

- **Rollback:** revert. Nothing calls the kernel yet.
