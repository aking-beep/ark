# @ark/guard

An in-process guard for one consequential tool. `guardTool` wraps a tool
handler so that the handler runs only when ARK's decision kernel
(`decideAction` in `@ark/core`) returns an explicit `allow`, and every attempt
leaves a privacy-safe receipt. See [ADR-0009](../../docs/adr/0009-action-accountability-wedge.md).

## Read this first: the enforcement boundary

- **Only tools routed through `guardTool` are protected.** The guard is a
  wrapper around one handler, not a proxy, a gateway or an MCP server. A tool
  you did not wrap is not guarded.
- **An agent that can call the side effect directly bypasses the guard.** If
  the agent's process can reach the refund API, the database or the payment
  client without going through the guarded handler, nothing here stops it. The
  boundary is only as strong as your guarantee that the guarded handler is the
  only path to the side effect — keep the credentials for the side effect out
  of the agent's reach and behind the guarded tool.
- **This is a simulation, not an approval workflow.** There is no approval
  service, inbox or UI in this package. `require_approval` returns
  `pending_approval` and executes nothing; there is no way, in this release, to
  turn a pending request into an approved one. Any approval-like field the
  sender puts in the arguments (`approvedBy`, `approved_by`, `approved-by`,
  `approvalToken`, `approverId`, … at any depth) is ignored and recorded as
  `sender_reported_approval_ignored`; top-level ones are also removed before
  validation. A handler must never read an approval from its `args`.
- **Idempotency stops accidental retries, not a determined caller.** If the key
  is chosen by the caller, a caller that mints a new key gets a new action, and
  the policy's per-call thresholds are not cumulative: fifty $100 refunds of one
  order are fifty `allow`s. Derive the key on the server side from the resource
  when the business allows one action per resource (see Usage), and see Known
  limits.
- **The demo is synthetic.** `src/demo/refund.ts` moves no money and calls no
  network. `DEMO_REFUND_POLICY`'s thresholds (≤ $100 allow, ≤ $1,000 approval,
  above that deny) are illustrative, not production defaults.

## Usage

```ts
import { guardTool } from '@ark/guard';
import { LibsqlActionReceiptStore } from '@ark/db';

const refund = guardTool({
  tool: 'payments',
  action: {
    name: 'refund',
    args: RefundArgs, // a zod schema
    toRequest: (a) => ({
      resource: { type: 'order', id: a.orderId },
      attributes: { amountMinor: a.amountMinor, currency: a.currency },
    }),
  },
  // Act on `request` (what was decided), not on `args`.
  handler: ({ request }) => payments.refund(request.resource.id, request.attributes.amountMinor),
  policies: () => loadOrgPolicies(),             // throws or hangs -> unknown, blocked
  resolveContext: () => sessionIdentity(),       // trusted: orgId, agentId, principal
  // Required. Recommended: derive it on the server side from the resource, so
  // one order gets at most one refund however many keys the agent invents.
  idempotency: { key: (a) => `refund:${a.orderId}` },
  receipts: new LibsqlActionReceiptStore(client),
  // clock: () => Date.now(),  // the default; `now` never comes from the request
  // telemetry: trace,         // an @ark/sdk TraceHandle; best-effort
});

const result = await refund(toolCallArguments);
// result.outcome: 'executed' | 'execution_failed' | 'blocked' | 'pending_approval' | 'replayed'
```

## What happens on each call

1. **Context.** `resolveContext()` supplies `orgId`, `agentId` and `principal`.
   Identity fields in the arguments are never read. If it throws, hangs or
   returns a malformed context, the call is blocked (`context_unavailable`) and
   no receipt is stored, because there is no trusted org to store it under.
2. **Validation.** Sender-reported approval fields are flagged (any depth) and
   removed (top level); the rest is parsed by the zod schema, deep-copied to
   plain data and frozen, so `toRequest` and the handler read the same values. `toRequest` maps it to the kernel's
   `resource` and `attributes`. Invalid arguments are blocked
   (`invalid_arguments`); a missing key is blocked (`idempotency_key_missing`).
3. **Policies.** Loaded with a timeout. A throw or timeout leaves no policies,
   so the kernel's answer is `unknown` and the call is blocked
   (`policy_source_failed` / `policy_source_timeout`).
4. **Decision.** `decideAction` runs on the guard's clock before any side
   effect. `deny` and `unknown` are `blocked`; `require_approval` is
   `pending_approval`. Neither invokes the handler.
5. **Claim.** On `allow`, the decision must still be fresh (not expired, clock
   not behind the decision time). The guard then claims the idempotency key
   atomically. The receipt store inserts the receipt as `attempted` against a
   unique `(org_id, idempotency_key_hash)` constraint, so of any number of
   concurrent calls with one key, at most one reaches the handler.
   - same key, same request → `replayed`: the first attempt's receipt and status,
     handler not invoked;
   - same key, different request (other arguments, other agent or principal)
     → `blocked` `idempotency_conflict`.
6. **Execution.** The handler gets the frozen arguments and the exact request
   the decision was made on. Returning a value records `completed`; returning
   `toolFailed()` records `failed`; throwing or exceeding the handler timeout
   records `outcome_unknown`. **Nothing is ever retried automatically**, and
   sending the same key again returns the recorded outcome without running the
   handler.

## Receipts

Stored per attempt, in `action_receipts` (`@ark/db`) or `MemoryReceiptStore`:
`org_id`, `id` (the kernel's decision id), `trace_id`, `agent_id`, `principal`,
`tool`, `action`, `resource_type`, `resource_id`, `policy_id`,
`policy_version`, `decision`, `reason_code`, `request_digest`,
`execution_status`, `idempotency_key_hash`, `sender_reported_approval`,
`amount_minor`, `currency`, `created_at`, `updated_at`.

Never stored: the arguments, free-text fields, prompts, customer PII,
secrets, credentials, the raw idempotency key (only its SHA-256), or the
handler's return value. Two caveats:

- `resource_id` and `principal` are stored as given. Use opaque ids (an order
  id, a user id), not an email address.
- The key hash is unsalted SHA-256. It hides a random key; it does not hide a
  guessable one. A key derived from the resource (`refund:<orderId>`) reveals
  nothing the receipt's `resource_id` does not already hold.

## Known limits

- **Idempotency is not a limit.** The key prevents re-executing one action
  (an accidental retry, a replayed message). It does not stop a caller that
  sends a new key, and `DEMO_REFUND_POLICY`'s thresholds apply per call, not
  per order or per day. Deriving the key from the resource (as the demo does)
  bounds refunds to one per order; it does not bound refunds across orders.
  **Follow-up, not in this release:** cumulative / per-resource limits
  (sum-per-resource, velocity) belong in the decision kernel, before real
  payments.
- **Store calls are bounded.** Every receipt-store call has a timeout
  (`timeouts.storeMs`, default 2 s). A store that fails, times out or answers
  something other than `claimed: true` before the handler blocks the call
  (`receipt_store_failed`). If the final status cannot be written after the
  handler ran, the result carries the true outcome plus `receipt_update_failed`,
  and the row keeps `attempted` ("possibly executed").

- **One decision, one receipt id.** The receipt id is the kernel's decision id,
  a content hash of the request including the guard's `now` in milliseconds.
  Two calls with identical requests in the same millisecond produce the same id:
  the second is blocked (`receipt_conflict`) rather than run without a receipt
  of its own.
- **`outcome_unknown` is final.** A handler that times out may still finish
  later; the guard does not update the receipt afterwards. Reconcile against
  the system of record.
- **`attempted` means "possibly executed".** It is written before the handler
  runs, so a crash between the claim and the handler leaves `attempted`, never
  `not_attempted`, and the key stays spent.
- **The in-memory store protects one process only.** Use the libSQL store
  (or another store with an atomic conditional insert) across processes.
- **Telemetry is best-effort.** It is handed to the sink on a later turn of the
  event loop, after the result is returned. A sink that throws, rejects or is
  slow never changes a decision or an execution. A sender's approval is never
  reported as `approvedBy`. Only an executed call is reported as `ok`; a replay
  executed nothing and is reported as `blocked` with `replay: true` and the
  first attempt's status, so one refund is never counted twice and an
  `outcome_unknown` is never reported as a success.

## Demo and tests

```
npm run demo:guard              # the eight synthetic scenarios, temp libSQL, no network
npm run test --workspace @ark/guard
```
