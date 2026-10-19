import { listActionReceipts, countActionReceipts } from '@ark/db';
import { Panel, Grid, Stat, Badge, CardTable, Callout, toneFor, fmt, type CardColumn } from '@ark/ui';
import { requireOrg } from '@/lib/org';
import { Basis } from '@/components/basis';
import {
  decisionLabel,
  executionLabel,
  executionNote,
  executionTone,
  isSimulation,
  formatAmount,
  formatWhen,
  policyLabel,
  tallyReceipts,
  receiptBasis,
  IGNORED_APPROVAL_TEXT,
  type DecisionLabel,
  type ExecutionLabel,
} from '@/lib/receipts';

export const dynamic = 'force-dynamic';

/** Where a developer learns to emit receipts. The app cannot serve repo files, so this is the source on GitHub. */
const GUARD_README = 'https://github.com/aking-beep/ark/blob/main/packages/guard/README.md';
const LIST_LIMIT = 200;

const DECISION_HINT: Record<DecisionLabel, string> = {
  allow: 'The policy allowed it. Whether it ran is under execution.',
  deny: 'Refused by policy. Nothing ran.',
  'pending approval': 'Needs a person. Nothing ran, and nothing in ARK can approve it yet.',
  unknown: 'No policy matched or the policy source failed, so it was blocked. Nothing ran.',
};

const EXECUTION_HINT: Record<ExecutionLabel, string> = {
  completed: 'The tool ran and returned.',
  'not attempted': 'The tool was never called.',
  failed: 'The tool ran and reported a failure.',
  'outcome unknown': 'Started, then crashed or timed out, or never recorded a final status. Reconcile.',
  unknown: 'No execution status was recorded.',
};

const COLUMNS: CardColumn[] = [
  { label: 'Time', align: 'left', mono: true, className: 'whitespace-nowrap text-2xs text-ink-400' },
  { label: 'Agent', align: 'left', mono: true, className: 'text-2xs' },
  { label: 'Tool and action', align: 'left' },
  { label: 'Resource', align: 'left', mono: true, className: 'text-2xs' },
  { label: 'Amount', align: 'right', mono: true, className: 'whitespace-nowrap' },
  { label: 'Policy', align: 'left', mono: true, className: 'text-2xs' },
  { label: 'Decision', align: 'left', className: 'min-w-[9rem]' },
  { label: 'Execution', align: 'left', className: 'min-w-[9rem]' },
  { label: 'Correlation', align: 'left' },
];

export default async function ActionsPage() {
  const { orgId, orgName } = await requireOrg();
  const [receipts, counts] = await Promise.all([
    listActionReceipts(orgId, { limit: LIST_LIMIT }),
    countActionReceipts(orgId),
  ]);
  const tally = tallyReceipts(counts);
  const claim = receiptBasis(tally.total);
  const footer = <Basis claim={claim} />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">Actions</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-400">
          Every protected action ARK decided on for {orgName}: what was requested, the policy decision, and what
          actually executed. Each row is a receipt <span className="font-mono">@ark/guard</span> wrote itself when
          the call was made — not a report from the agent.
        </p>
      </header>

      {tally.total === 0 ? (
        <Panel title="No action receipts yet">
          <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-ink-300">
            <p>
              Receipts appear here when a consequential tool is wrapped with{' '}
              <span className="font-mono text-ink-100">guardTool</span> from{' '}
              <span className="font-mono text-ink-100">@ark/guard</span> and given the libSQL receipt store
              (<span className="font-mono text-ink-100">LibsqlActionReceiptStore</span> from{' '}
              <span className="font-mono text-ink-100">@ark/db</span>) with this org&apos;s id in its trusted
              context. Every call then leaves one receipt — allowed, denied, pending approval or blocked.
            </p>
            <p>Tools that are not wrapped are not guarded, and do not appear here.</p>
            <p>
              <a href={GUARD_README} className="text-signal underline underline-offset-2" rel="noreferrer">
                How to emit receipts: packages/guard/README.md
              </a>
            </p>
          </div>
        </Panel>
      ) : (
        <>
          <Callout tone="info" title="Nothing on this page was approved through ARK">
            &ldquo;Pending approval&rdquo; means a person has to approve the action and it did not run. ARK has no
            approval workflow yet, so nothing here moves from pending to approved. An approval the agent put in its
            own arguments is ignored and says so on its row.
          </Callout>

          <section aria-labelledby="by-decision" className="space-y-3">
            <h2 id="by-decision" className="text-sm font-semibold text-ink-100">By decision</h2>
            <Grid cols={4}>
              {(Object.keys(DECISION_HINT) as DecisionLabel[]).map((l) => (
                // Every decision is a neutral fact: a deny or a block is the guard working, not an alarm.
                <Stat key={l} label={l} value={fmt.int(tally.decisions[l])} hint={DECISION_HINT[l]} footer={footer} />
              ))}
            </Grid>
          </section>

          <section aria-labelledby="by-execution" className="space-y-3">
            <h2 id="by-execution" className="text-sm font-semibold text-ink-100">By execution status</h2>
            <Grid cols={4}>
              {(Object.keys(EXECUTION_HINT) as ExecutionLabel[])
                .filter((l) => l !== 'unknown' || tally.executions.unknown > 0)
                .map((l) => (
                  <Stat
                    key={l}
                    label={l}
                    value={fmt.int(tally.executions[l])}
                    // Colour only on a non-zero count, and only because the basis is measured.
                    tone={tally.executions[l] > 0 ? toneFor(claim, executionTone(l)) : 'neutral'}
                    hint={EXECUTION_HINT[l]}
                    footer={footer}
                  />
                ))}
            </Grid>
          </section>

          <Panel
            title="Receipts"
            subtitle={
              receipts.length < tally.total
                ? `The ${fmt.int(receipts.length)} most recent of ${fmt.int(tally.total)}, newest first.`
                : `${fmt.int(tally.total)} ${tally.total === 1 ? 'receipt' : 'receipts'}, newest first.`
            }
            right={footer}
          >
            <CardTable
              label="Action receipts"
              columns={COLUMNS}
              rows={receipts.map((r) => {
                const decision = decisionLabel(r.decision);
                const execution = executionLabel(r.executionStatus);
                const note = executionNote(r.executionStatus);
                return {
                  key: r.id,
                  cells: [
                    <span key="t" data-receipt-row>{formatWhen(r.createdAt)}</span>,
                    <Id key="a" value={r.agentId} />,
                    <span key="tool" className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs text-ink-100">
                        {r.tool}.{r.action}
                      </span>
                      {isSimulation(r) && (
                        <Badge tone="info" title="Synthetic guard demo: an in-memory ledger, no money moved.">
                          simulation
                        </Badge>
                      )}
                    </span>,
                    <span key="res">
                      {r.resourceType ?? 'unknown type'}{' '}
                      <span className="text-ink-100">{r.resourceId ? <Id value={r.resourceId} /> : '—'}</span>
                    </span>,
                    formatAmount(r.amountMinor, r.currency),
                    <Id key="p" value={policyLabel(r)} />,
                    <div key="d" className="space-y-1">
                      <Badge tone="neutral">{decision}</Badge>
                      <p className="font-mono text-2xs text-ink-500">{r.reasonCode}</p>
                      {r.senderReportedApproval && (
                        <p className="text-2xs leading-relaxed text-ink-300">{IGNORED_APPROVAL_TEXT}</p>
                      )}
                    </div>,
                    <div key="e" className="space-y-1">
                      <Badge tone={toneFor(claim, executionTone(execution))}>{execution}</Badge>
                      {note && <p className="text-2xs leading-relaxed text-ink-400">{note}</p>}
                    </div>,
                    <div key="c" className="space-y-1 font-mono text-2xs text-ink-400">
                      <CorrelationId kind="decision" value={r.id} />
                      {r.traceId && <CorrelationId kind="trace" value={r.traceId} />}
                    </div>,
                  ],
                };
              })}
            />
          </Panel>
        </>
      )}
    </div>
  );
}

/** An identifier that may break after `_`, `.`, `:` or `-`, never mid-word. */
function Id({ value }: { value: string }) {
  const parts = value.split(/(?<=[_.:\-])/);
  return (
    <span>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <wbr />}
        </span>
      ))}
    </span>
  );
}

/**
 * A long hash shown as its first 16 characters (as the guard demo prints it),
 * with the whole value one keypress away: `<summary>` is focusable and opens
 * with Enter or Space, so the full id is not hover-only.
 */
function CorrelationId({ kind, value }: { kind: 'decision' | 'trace'; value: string }) {
  if (value.length <= 20) {
    return (
      <p>
        <span className="text-ink-500">{kind} </span>
        <span className="text-ink-300">{value}</span>
      </p>
    );
  }
  return (
    <details className="group">
      <summary className="cursor-pointer whitespace-nowrap rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/60">
        <span className="text-ink-500">{kind} </span>
        <span className="text-ink-300">{value.slice(0, 16)}…</span>
        <span className="sr-only"> (show the full {kind} id)</span>
      </summary>
      <p className="mt-1 break-all text-ink-300">{value}</p>
    </details>
  );
}
