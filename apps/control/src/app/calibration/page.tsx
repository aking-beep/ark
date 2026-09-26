import { calibration } from '@ark/db';
import { Panel, Table, Td, Badge, BasisTag, Callout, fmt } from '@ark/ui';
import { requireOrg, WINDOW_DAYS } from '@/lib/org';

export const dynamic = 'force-dynamic';

const MIN_SAMPLE = 30;

export default async function Calibration() {
  const { orgId } = await requireOrg();
  const set = await calibration(orgId, WINDOW_DAYS);
  const usable = set.patterns.filter((p) => p.sampleSize >= MIN_SAMPLE);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">Calibration</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-400">
          This is the join between the two products, and the reason Control is built before AI Fit Teams. AI Fit Teams ships
          with rules of thumb about how many turns a pattern takes and how often it fails. Control measures
          those same quantities in production and hands them back, so the assessment stops guessing.
        </p>
      </header>

      <Callout tone={usable.length ? 'good' : 'warn'} title={usable.length ? 'Live priors' : 'Not enough data yet'}>
        {usable.length ? (
          <>
            {usable.length} of {set.patterns.length} patterns clear the {MIN_SAMPLE}-trace floor and will
            override AI Fit Teams&apos; rubric. Estimates for those patterns are labelled{' '}
            <span className="font-mono text-good">measured</span> rather than{' '}
            <span className="font-mono text-warn">heuristic</span>.
          </>
        ) : (
          <>
            No pattern has {MIN_SAMPLE} traces yet, so AI Fit Teams keeps using its own priors and keeps saying so.
            Thin samples are worse than honest rules of thumb, because they look like evidence.
          </>
        )}
      </Callout>

      <Panel
        title="Observed priors by architecture pattern"
        subtitle={`Window: ${set.windowDays} days · generated ${new Date(set.generatedAt).toLocaleString()}`}
        right={<BasisTag basis={set.basis} source={`org ${set.orgId ?? orgId}`} />}
      >
        <Table head={['Pattern', 'Turns', 'p95 turns', 'Ctx growth', 'Failure', 'Retries', 'Cache', 'Cost/outcome', 'n']}>
          {set.patterns.map((p) => {
            const usableRow = p.sampleSize >= MIN_SAMPLE;
            return (
              <tr key={p.pattern} className={usableRow ? '' : 'opacity-50'}>
                <Td align="left">
                  <span className="font-mono text-xs text-ink-100">{p.pattern}</span>
                  {!usableRow && (
                    <Badge tone="warn" className="ml-2">
                      below floor
                    </Badge>
                  )}
                </Td>
                <Td mono>{p.turnsPerOutcome.toFixed(2)}</Td>
                <Td mono className="text-ink-400">{p.p95TurnsPerOutcome?.toFixed(0) ?? '—'}</Td>
                <Td mono>{fmt.int(p.contextGrowthPerTurn)}</Td>
                <Td mono className={p.failureRate > 0.1 ? 'text-warn' : undefined}>
                  {fmt.pct(p.failureRate * 100, 1)}
                </Td>
                <Td mono>{p.retriesPerFailure.toFixed(2)}</Td>
                <Td mono>{fmt.pct(p.cacheHitRate * 100, 0)}</Td>
                <Td mono>{p.costPerOutcomeUsd != null ? fmt.usd(p.costPerOutcomeUsd) : '—'}</Td>
                <Td mono className={usableRow ? 'text-good' : 'text-warn'}>{fmt.int(p.sampleSize)}</Td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-3 text-2xs leading-relaxed text-ink-500">
          The p95 column exists so AI Fit Teams can show a range rather than a false point estimate. The gap between
          the mean and the p95 turn count is where agent budgets go to die.
        </p>
      </Panel>

      <Panel title="Consumed by AI Fit Teams" subtitle="The teams assessment fetches this on every report.">
        <pre className="overflow-x-auto rounded-lg bg-ink-900 p-4 font-mono text-2xs leading-relaxed text-ink-300">
{`GET /api/v1/calibration?days=${WINDOW_DAYS}
Authorization: Bearer <org ingest token>

# Org is taken from the token, never from an unauthenticated query param.`}
        </pre>
      </Panel>
    </div>
  );
}
