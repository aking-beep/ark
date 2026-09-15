import Link from 'next/link';
import { listWorkloads, spendSummary, qualityByWorkload } from '@ark/db';
import { Panel, Table, Td, Badge, fmt, type Tone } from '@ark/ui';
import { requireOrg, WINDOW_DAYS } from '@/lib/org';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, Tone> = {
  proposed: 'neutral',
  shadow: 'info',
  assisted: 'signal',
  live: 'good',
  retired: 'neutral',
};

export default async function Workloads() {
  const { orgId } = await requireOrg();
  const [workloads, spend, quality] = await Promise.all([
    listWorkloads(orgId),
    spendSummary(orgId, WINDOW_DAYS),
    qualityByWorkload(orgId, WINDOW_DAYS),
  ]);

  const spendBy = new Map(spend.byWorkload.map((w) => [w.workloadId, w]));
  const qualityBy = new Map(quality.map((q) => [q.workloadId, q]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">Workloads</h1>
        <p className="mt-1 text-sm text-ink-400">
          A workload is one unit of business work, not one model call. Everything attributes here.
        </p>
      </header>

      <Panel>
        <Table head={['Workload', 'Pattern', 'Status', 'Spend', 'Per outcome', 'Accuracy']}>
          {workloads.map((w) => {
            const s = spendBy.get(w.id);
            const q = qualityBy.get(w.id);
            return (
              <tr key={w.id} className="hover:bg-ink-800/40">
                <Td align="left">
                  <Link href={`/workloads/${w.id}`} className="text-ink-100 hover:text-signal">
                    {w.name}
                  </Link>
                  <p className="mt-0.5 max-w-md text-2xs leading-relaxed text-ink-500">
                    {w.spec?.description}
                  </p>
                </Td>
                <Td align="left">
                  <span className="font-mono text-2xs text-ink-300">{w.pattern}</span>
                </Td>
                <Td align="left">
                  <Badge tone={STATUS_TONE[w.status] ?? 'neutral'}>{w.status}</Badge>
                </Td>
                <Td mono>{s ? fmt.usd(s.costUsd, 2) : '—'}</Td>
                <Td mono className="text-ink-100">{s ? fmt.usd(s.costPerOutcome) : '—'}</Td>
                <Td mono>{q ? fmt.pct(q.accuracy * 100, 1) : <span className="text-ink-600">unsampled</span>}</Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </div>
  );
}
