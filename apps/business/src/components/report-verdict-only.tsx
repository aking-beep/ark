import Link from 'next/link';
import {
  taskFit,
  recommendArchitecture,
  roadmap,
  PATTERN_LABEL,
  type Workload,
} from '@ark/core';
import { Panel, Badge, BasisTag, Callout, DimensionList } from '@ark/ui';
import { ReportFooter, intakeHref } from './report-footer';

/**
 * The verdict-only report (`scope=verdict`).
 *
 * The intake sends people here as soon as the shapes alone decide not-ai,
 * with neutral placeholders in every field it never asked about. So this page
 * reads the job name and the task shapes and nothing else: no volume, cost,
 * payback, model, risk level, evaluation or Measure, because every one of
 * those would be computed from a placeholder and presented as an answer.
 * Each function called below is one whose not-ai branch ignores the rest of
 * the workload; the core tests pin that.
 */
export function VerdictOnlyReport({ workload, encoded }: { workload: Workload; encoded: string }) {
  const fit = taskFit(workload.task);
  const arch = recommendArchitecture(workload, 'not-ai');
  const phases = roadmap(workload, arch.pattern, 'not-ai');
  const continueHref = intakeHref(encoded, 1);

  return (
    <div className="space-y-10">
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-ink-400">{workload.name}</p>
          <Badge tone="neutral">verdict from the shape of the work</Badge>
        </div>
        <h1 className="mt-3 text-4xl font-semibold leading-tight text-danger">Do not use a model for this</h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-300">
          You described {describeShapes(workload.task)}. That has a computable right answer. A deterministic
          implementation is correct by construction, testable, and costs approximately nothing to run. A
          language model would be probabilistic about something that does not need to be.
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-400">
          Nothing later in the assessment can change this verdict, which is why the report stops here.
        </p>
      </section>

      <Panel title="Why" subtitle="One dimension decides it. The other six would only size a model project, and there is not one to size.">
        {fit.blocker && (
          <Callout tone="danger" title="Blocker">
            <p>{fit.blocker}</p>
          </Callout>
        )}
        <div className="mt-5">
          <DimensionList dimensions={[fit.dimension]} showWeight />
        </div>
      </Panel>

      <Panel title="What to build instead" subtitle="And what was considered and rejected.">
        <Badge tone="signal">{arch.label}</Badge>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-300">{arch.summary}</p>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wider text-ink-400">Components</h2>
            <ul className="mt-2.5 space-y-1.5">
              {arch.components.map((c) => (
                <li key={c} className="flex gap-2 text-xs leading-relaxed text-ink-300">
                  <span className="text-ink-500" aria-hidden>&middot;</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wider text-ink-400">Rejected, and why</h2>
            <ul className="mt-2.5 space-y-3">
              {arch.rejected.map((r) => (
                <li key={r.pattern}>
                  <p className="font-mono text-2xs text-ink-400">{PATTERN_LABEL[r.pattern] ?? r.pattern}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{r.why}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel
        title="Roadmap"
        subtitle="One phase, with a kill criterion that is a good outcome."
        right={<BasisTag basis="heuristic" source="ARK roadmap rubric — phase durations are rules of thumb" />}
      >
        <ol className="space-y-5">
          {phases.map((p) => (
            <li key={p.name} className="border-l border-ink-700 pl-6">
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="text-sm font-medium text-ink-100">{p.name}</h3>
                <span className="font-mono text-2xs text-ink-400">
                  about {p.durationWeeks} week{p.durationWeeks === 1 ? '' : 's'}
                </span>
              </div>
              <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-ink-300">{p.goal}</p>
              <ul className="mt-2.5 space-y-1">
                {p.exitCriteria.map((e) => (
                  <li key={e} className="text-xs leading-relaxed text-ink-400">&#10003; {e}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs leading-relaxed text-danger/90">
                <span className="font-medium">Kill if:</span> {p.killCriteria}
              </p>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Not asked, because it would not change this verdict">
        <ul className="space-y-2.5">
          {NOT_ASKED.map(([what, why]) => (
            <li key={what} className="text-sm leading-relaxed text-ink-300">
              <span className="text-ink-100">{what}.</span> <span className="text-ink-400">{why}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 max-w-3xl text-xs leading-relaxed text-ink-400">
          If you want the build sized anyway — what the deterministic version costs to build, the controls it
          needs, how to test it — the full assessment asks for these and produces the complete document.{' '}
          <Link href={continueHref} className="text-signal underline underline-offset-2">
            Continue the full assessment
          </Link>
          .
        </p>
      </Panel>

      <ReportFooter edit={{ href: continueHref, label: 'Continue the full assessment' }} />
    </div>
  );
}

const NOT_ASKED: [string, string][] = [
  ['Volume', 'How many a month sizes the payback of a model. Rules cost the same at ten or ten million.'],
  ['Input and output size', 'Token counts price model calls. There are none.'],
  ['Correctness and error tolerance', 'A rule is right or it has a bug. Tests decide that, not a tolerance band.'],
  ['Data sensitivity and regulation', 'They set the controls on a model project. Your existing access controls cover a query.'],
  ['Actions and autonomy', 'They gate what a model may do unsupervised. A rule only does what it was written to do.'],
  ['Team and today’s cost', 'They size the build and the saving. Ask for those in the full assessment if you need them.'],
];

function describeShapes(task: readonly string[]): string {
  const has = (s: string) => task.includes(s);
  if (has('lookup') && has('calculate')) return 'looking up a known record and calculating from it';
  if (has('lookup')) return 'looking up a known record by its key';
  return 'a calculation with one correct result';
}

