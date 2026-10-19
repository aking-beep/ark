/**
 * How /actions words and colours an action receipt. No Next or @ark imports,
 * so receipts.test.ts runs under plain `node --test`.
 *
 * Every label here is a claim about what happened, so the rule is: never say
 * more than the receipt recorded. A pending approval is not an approval, an
 * approval the agent wrote into its own arguments is not an approval, and a
 * status the guard did not record is unknown, never a success.
 */

import type { BasisClaim } from './basis';

export type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info' | 'signal';

/** The receipt fields this page reads. Structurally a subset of `ActionReceipt` from @ark/core. */
export interface ReceiptView {
  id: string;
  traceId: string | null;
  agentId: string;
  tool: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  policyId: string | null;
  policyVersion: number | null;
  decision: string | null | undefined;
  reasonCode: string;
  executionStatus: string | null | undefined;
  senderReportedApproval: boolean;
  amountMinor: number | null;
  currency: string | null;
  createdAt: number;
}

export type DecisionLabel = 'allow' | 'deny' | 'pending approval' | 'unknown';
export type ExecutionLabel = 'completed' | 'not attempted' | 'failed' | 'outcome unknown' | 'unknown';

export const DECISION_LABELS: readonly DecisionLabel[] = ['allow', 'deny', 'pending approval', 'unknown'];
export const EXECUTION_LABELS: readonly ExecutionLabel[] = ['completed', 'not attempted', 'failed', 'outcome unknown', 'unknown'];

/**
 * `require_approval` is "pending approval": there is no approval service, so
 * nothing can move it on. Anything unrecognised is `unknown`.
 */
export function decisionLabel(decision: string | null | undefined): DecisionLabel {
  switch (decision) {
    case 'allow':
      return 'allow';
    case 'deny':
      return 'deny';
    case 'require_approval':
      return 'pending approval';
    default:
      return 'unknown';
  }
}

/**
 * `attempted` is written before the handler runs and means "possibly
 * executed": the final status never landed. It is an outcome nobody knows,
 * so it reads as one. A missing or unrecognised status is `unknown`.
 */
export function executionLabel(status: string | null | undefined): ExecutionLabel {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'not_attempted':
      return 'not attempted';
    case 'failed':
      return 'failed';
    case 'outcome_unknown':
    case 'attempted':
      return 'outcome unknown';
    default:
      return 'unknown';
  }
}

/** Shown under the execution status when a row needs more than the label. */
export function executionNote(status: string | null | undefined): string | null {
  if (status === 'attempted') return 'Started; no final status was recorded. It may have executed.';
  if (status === 'outcome_unknown') return 'The tool crashed or timed out after starting. Reconcile with the system of record.';
  if (executionLabel(status) === 'unknown') return 'No execution status recorded.';
  return null;
}

/**
 * The colour an execution state would earn. Callers pass it through
 * `toneFor` with the receipts' basis (measured), so colour follows provenance.
 * Every decision — allow, deny, pending approval, unknown — is neutral: denied
 * and blocked are what the guard is for, facts and not alarms. Only an outcome
 * someone has to reconcile is amber.
 */
export function executionTone(label: ExecutionLabel): Tone {
  if (label === 'completed') return 'good';
  if (label === 'failed' || label === 'outcome unknown') return 'warn';
  return 'neutral';
}

/** Said in words on the row, so it never needs a tooltip to be seen. */
export const IGNORED_APPROVAL_TEXT =
  'The agent sent an approval in its own arguments. ARK ignored it: a sender-reported approval is not an approval.';

/**
 * The guard demo's identity (`@ark/guard` src/demo): its agent calls
 * `payments.refund` and, in the unknown-tool scenario, `billing.refund`.
 * Matched on agent and tool together, so a real `payments.refund` from any
 * other agent is never painted as a simulation.
 */
export const DEMO_AGENT_ID = 'agent_support_bot';
export const DEMO_TOOL_IDS: ReadonlySet<string> = new Set(['payments.refund', 'billing.refund']);

export function isSimulation(r: Pick<ReceiptView, 'agentId' | 'tool' | 'action'>): boolean {
  return r.agentId === DEMO_AGENT_ID && DEMO_TOOL_IDS.has(`${r.tool}.${r.action}`);
}

const KNOWN_CURRENCIES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('currency'));

/** Minor units to a display amount, using the currency's own exponent (JPY 0, USD 2, KWD 3). */
export function formatAmount(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null) return '—';
  if (!currency) return `${amountMinor.toLocaleString('en-US')} (minor units, no currency)`;
  // Intl formats any well-formed code and assumes two decimals for one it does
  // not know, which would be a guess about where the decimal point goes.
  if (!KNOWN_CURRENCIES.has(currency)) return `${amountMinor.toLocaleString('en-US')} ${currency} (minor units)`;
  try {
    const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' });
    const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
    return nf.format(amountMinor / 10 ** digits).replace(/ /g, ' ');
  } catch {
    return `${amountMinor.toLocaleString('en-US')} ${currency} (minor units)`;
  }
}

/** Absolute and in UTC: a receipt is a record, and "3h ago" ages on a screenshot. */
export function formatWhen(ts: number): string {
  if (!Number.isFinite(ts)) return 'unknown';
  return `${new Date(ts).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

export function policyLabel(r: Pick<ReceiptView, 'policyId' | 'policyVersion'>): string {
  if (!r.policyId) return 'no matching policy';
  return r.policyVersion === null ? `${r.policyId} (version not recorded)` : `${r.policyId} v${r.policyVersion}`;
}

export interface ReceiptTally {
  total: number;
  decisions: Record<DecisionLabel, number>;
  executions: Record<ExecutionLabel, number>;
}

/** Folds the stored values (from `countActionReceipts`) onto the display labels. */
export function tallyReceipts(counts: {
  total: number;
  byDecision: Record<string, number>;
  byExecutionStatus: Record<string, number>;
}): ReceiptTally {
  const decisions = Object.fromEntries(DECISION_LABELS.map((l) => [l, 0])) as Record<DecisionLabel, number>;
  const executions = Object.fromEntries(EXECUTION_LABELS.map((l) => [l, 0])) as Record<ExecutionLabel, number>;
  for (const [k, n] of Object.entries(counts.byDecision)) decisions[decisionLabel(k)] += n;
  for (const [k, n] of Object.entries(counts.byExecutionStatus)) executions[executionLabel(k)] += n;
  return { total: counts.total, decisions, executions };
}

/** Every summary figure on /actions is a count of receipts, measured by the guard that wrote them. */
export function receiptBasis(total: number): BasisClaim {
  return {
    basis: 'measured',
    source: `${total.toLocaleString('en-US')} action ${total === 1 ? 'receipt' : 'receipts'}, decided and recorded by @ark/guard`,
    sampleSize: total,
    // The trace floor is about rates and costs; a count of receipts is exact.
    belowFloor: false,
  };
}
