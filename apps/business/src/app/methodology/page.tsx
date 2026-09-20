import { Panel, Table, Td, Badge, BasisTag } from '@ark/ui';
import { CALL_SHAPE, PATTERN_LABEL, type Pattern } from '@ark/core';

export const metadata = { title: 'Methodology — MY AI for teams' };

/**
 * The methodology page exists so the report can be argued with.
 *
 * A scoring tool that will not show its rubric is asking to be trusted on
 * charisma. Everything that drives a verdict is written down here, including
 * the parts that are guesses.
 */
export default function Methodology() {
  return (
    <div className="space-y-8">
      <section className="max-w-3xl">
        <h1 className="text-3xl font-semibold leading-tight text-ink-100">How this is scored</h1>
        <p className="mt-4 text-base leading-relaxed text-ink-300">
          Everything below is the actual rubric, not a summary of one. If a report tells you something you
          disagree with, this page should let you find the exact assumption you disagree with and say so.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink-400">
          This product is the estimator. ARK Control is the measurement. They are the only two surfaces that
          talk. The map — Assess → Measure → Control, four grains on one trace, how a figure is promoted
          from heuristic to measured — is <code className="font-mono text-ink-200">docs/08-how-ark-works.md</code>.
          Connect production at Control <code className="font-mono text-ink-200">/start</code>.
        </p>
      </section>

      <Panel title="The provenance ladder" subtitle="Four rungs. Every figure in every report carries one.">
        <p className="max-w-3xl text-sm leading-relaxed text-ink-300">
          The central design commitment of this system is that a guess and a measurement must never look the
          same on screen. Confidence in a user interface is a claim, and an unlabelled number is a claim
          made without evidence.
        </p>
        <div className="mt-5 space-y-3">
          <Rung basis="heuristic">
            A rule of thumb from the rubric. Defensible, arguable, and not observed anywhere. Most cost
            figures start here.
          </Rung>
          <Rung basis="benchmark">
            A published figure — a model&apos;s list price, a vendor&apos;s stated context window, a
            third-party benchmark. True of the world, not necessarily of you.
          </Rung>
          <Rung basis="calibrated">
            Derived from measurements taken on systems like yours, but not yours. Useful, and still a prior.
          </Rung>
          <Rung basis="measured">
            Computed from telemetry emitted by your own running workload, above the sample floor. This is
            the only rung that can contradict the rubric, and it is allowed to.
          </Rung>
        </div>
        <p className="mt-5 max-w-3xl text-xs leading-relaxed text-ink-400">
          A prior is promoted only above a minimum sample of 30 traces for that pattern. Below the floor the
          number stays <span className="font-mono text-warn">heuristic</span> and says so, because a mean
          drawn from four traces is noise wearing a decimal point.
        </p>
      </Panel>

      <Panel
        title="The seven suitability dimensions"
        subtitle="Weighted. The weakest dimension usually decides the verdict, which is deliberate."
      >
        <Table head={['Dimension', 'Weight', 'What moves it']}>
          {DIMENSIONS.map((d) => (
            <tr key={d.key} className="border-t border-ink-800 align-top">
              <Td align="left" className="pr-4">
                <span className="text-ink-200">{d.label}</span>
              </Td>
              <Td mono>{d.weight.toFixed(2)}</Td>
              <Td align="left" className="pl-4">
                <span className="text-xs leading-relaxed text-ink-400">{d.drivers}</span>
              </Td>
            </tr>
          ))}
        </Table>
        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-400">
          A weighted average alone would let a high volume score paper over a workload that must be exactly
          right. It does not: a small number of conditions are hard blockers that cap the verdict regardless
          of the total, and the report lists them by name.
        </p>
      </Panel>

      <Panel
        title="Assumed call shapes"
        subtitle="Per architecture pattern. These are the figures ARK Control replaces with measurement."
      >
        <Table head={['Pattern', 'Turns / outcome', 'Context growth / turn', 'Failure rate', 'Retries', 'Cache hit']}>
          {(Object.keys(CALL_SHAPE) as Pattern[]).map((p) => {
            const s = CALL_SHAPE[p];
            return (
              <tr key={p} className="border-t border-ink-800">
                <Td align="left" className="pr-4">
                  <span className="text-ink-200">{PATTERN_LABEL[p]}</span>
                  <span className="mt-0.5 block font-mono text-2xs text-ink-600">{p}</span>
                </Td>
                <Td mono>{s.turnsPerOutcome}</Td>
                <Td mono>{s.contextGrowthPerTurn}</Td>
                <Td mono>{(s.failureRate * 100).toFixed(0)}%</Td>
                <Td mono>{s.retriesPerFailure}</Td>
                <Td mono>{(s.cacheHitRate * 100).toFixed(0)}%</Td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-400">
          Turns per outcome and failure rate are where cost estimates go wrong by an order of magnitude. An
          agent that averages seven turns in a benchmark and nineteen in production is not a rounding error
          — it is a bill that arrives at nearly three times the forecast, and no amount of care with the
          price-per-token column will catch it.
        </p>
      </Panel>

      <Panel title="How cost is computed" subtitle="Cost per successful outcome, not cost per call.">
        <div className="space-y-4 text-sm leading-relaxed text-ink-300">
          <p>
            One attempt costs the input tokens plus the accumulated context of every prior turn, priced at
            the model&apos;s input rate, plus the output tokens at the output rate, less the share of input
            served from cache at the cached-read rate. Context is accumulated per turn rather than assumed
            constant — the thing that makes agents expensive is not the number of calls, it is that call
            seven carries the transcript of calls one through six.
          </p>
          <p>
            An outcome costs one attempt, plus the failure rate multiplied by the retries per failure,
            multiplied by the cost of an attempt. Divide by the success rate and you get the cost of a
            result you can actually use. That is the number this report quotes.
          </p>
          <p className="text-ink-400">
            Every tool that quotes a price per thousand tokens and stops there is quoting the cost of the
            attempt, not the cost of the outcome. For a single-shot classifier the gap is a few per cent.
            For a bounded agent it is routinely forty.
          </p>
        </div>
      </Panel>

      <Panel title="Where the report refuses to answer" subtitle="The parts that are deliberately blank.">
        <ul className="space-y-3 text-sm leading-relaxed text-ink-300">
          <li className="flex gap-2">
            <span className="text-warn">&middot;</span>
            <span>
              <span className="text-ink-100">ROI without a baseline.</span> If you do not tell it what the
              work costs today, it reports payback as unknowable rather than inventing a denominator. A
              fabricated ROI is worse than no ROI, because it survives being repeated.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-warn">&middot;</span>
            <span>
              <span className="text-ink-100">Accuracy.</span> This tool cannot tell you how accurate a model
              will be on your data. Nobody can, before the golden set exists. What it gives you instead is
              the threshold your error tolerance implies and the size of the set you need to measure it
              honestly.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-warn">&middot;</span>
            <span>
              <span className="text-ink-100">The human baseline.</span> If you did not supply a human error
              rate, the report says so rather than treating your current process as perfect. &ldquo;93%
              accurate&rdquo; is a result or a regression depending entirely on a number most teams have
              never measured.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-warn">&middot;</span>
            <span>
              <span className="text-ink-100">Displacement.</span> AI removing 60% of the human minutes on a
              task is an assumption, stated as one and adjustable. Teams routinely model it as 100% and are
              routinely wrong.
            </span>
          </li>
        </ul>
      </Panel>

      <Panel title="Known limitations" subtitle="Written down so they can be argued with rather than discovered.">
        <ul className="space-y-2.5 text-xs leading-relaxed text-ink-400">
          {LIMITATIONS.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-ink-600">&middot;</span>
              {l}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Rung({ basis, children }: { basis: 'heuristic' | 'benchmark' | 'calibrated' | 'measured'; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 rounded-lg border border-ink-800 bg-ink-900 p-4">
      <div className="shrink-0 pt-0.5">
        <BasisTag basis={basis} />
      </div>
      <p className="text-xs leading-relaxed text-ink-400">{children}</p>
    </div>
  );
}

const DIMENSIONS = [
  {
    key: 'taskFit', label: 'Task fit', weight: 0.22,
    drivers: 'The shapes you selected. Calculate and Look up alone score near zero and raise a hard blocker; genuinely linguistic or judgement work scores high.',
  },
  {
    key: 'determinism', label: 'Determinism demand', weight: 0.18,
    drivers: 'Whether one answer is correct. "Exact" is the single strongest negative signal in the rubric, because probabilistic systems are a poor fit for verifiable questions.',
  },
  {
    key: 'errorTolerance', label: 'Error tolerance', weight: 0.15,
    drivers: 'What a wrong answer costs, adjusted by whether anyone would notice. Zero tolerance combined with nobody checking caps the verdict at assisted.',
  },
  {
    key: 'volume', label: 'Volume', weight: 0.15,
    drivers: 'Units per month against build cost. Below a few hundred, almost nothing repays the engineering, and the report says so rather than finding a way.',
  },
  {
    key: 'dataRisk', label: 'Data sensitivity', weight: 0.12,
    drivers: 'Data classes in scope and the regimes they trigger. Raises control requirements and lowers the autonomy ceiling.',
  },
  {
    key: 'actionRisk', label: 'Action risk', weight: 0.10,
    drivers: 'Write access and blast radius. An irreversible action with full autonomy is the one combination that is blocked outright.',
  },
  {
    key: 'readiness', label: 'Team readiness', weight: 0.08,
    drivers: 'Engineers, prior ML operations experience, security review, and out-of-hours coverage. Small teams get simpler patterns, not smaller versions of complex ones.',
  },
];

const LIMITATIONS = [
  'Token estimates come from your description of the workload. If your real prompts are twice the size you think they are — and they usually are, once system prompts, few-shot examples and retrieved context are counted — every cost figure scales with them.',
  'Model prices are captured from published rates on a known date and carry an expiry. A promotional rate that lapses is the most common way a correct forecast becomes wrong without anyone changing anything.',
  'Build cost is a rubric estimate against a loaded engineering rate. It has no knowledge of your integration surface, your procurement process, or your security review queue, and those are frequently the long pole.',
  'The evaluation plan tells you what to measure and what threshold to hold. It cannot tell you whether you will hit it.',
  'Calibration draws on your own telemetry once Control is running, which means it is accurate about the workloads you already operate and silent about the ones you do not.',
  'This tool assesses one workload at a time. Portfolio effects — shared retrieval infrastructure, a platform team amortised across six projects, a volume commitment — are real and are not modelled here.',
];
