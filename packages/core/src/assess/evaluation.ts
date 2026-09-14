import { Workload } from '../schema/workload.js';
import { Pattern } from './architecture.js';

/**
 * Evaluation plan.
 *
 * Every threshold here is derived from the workload's own stated tolerance,
 * so the numbers are the customer's commitments rather than ARK's opinion.
 * The gate list is what "done" means — without it, "it seems to work" is the
 * acceptance criterion, which is how most of these projects actually fail.
 */

export interface Metric {
  name: string;
  threshold: string;
  measuredHow: string;
  blocksLaunch: boolean;
}

export interface EvaluationPlan {
  goldenSetSize: number;
  metrics: Metric[];
  cadence: string;
  humanBaselineNote: string;
  regressionPolicy: string;
}

export function evaluationPlan(w: Workload, pattern: Pattern): EvaluationPlan {
  const tol = w.errorTolerance;
  const accuracy = { none: 0.99, low: 0.97, medium: 0.93, high: 0.85 }[tol];
  const units = w.volume.unitsPerMonth;

  // Enough examples to distinguish the threshold from noise, capped at what
  // a human will realistically label.
  const goldenSetSize = Math.min(1000, Math.max(120, Math.ceil(units * 0.02)));

  const metrics: Metric[] = [
    {
      name: 'Task accuracy on the golden set',
      threshold: `>= ${(accuracy * 100).toFixed(0)}%`,
      measuredHow: `Human-labelled holdout of ${goldenSetSize} real examples, sampled across the full input distribution — not the easy ones.`,
      blocksLaunch: true,
    },
    {
      name: 'Accuracy vs. the human baseline',
      threshold: w.current.humanErrorRate !== undefined
        ? `Error rate <= ${((w.current.humanErrorRate) * 100).toFixed(1)}% (today's human rate)`
        : 'Baseline not yet measured — measure it before launch',
      measuredHow: 'Same golden set, scored against how the current process actually performs.',
      blocksLaunch: true,
    },
    {
      name: 'Cost per successful outcome',
      threshold: 'Within 20% of the modelled figure',
      measuredHow: 'ARK Control, attributed to this workload, retries and failed attempts included.',
      blocksLaunch: false,
    },
    {
      name: 'p95 latency',
      threshold: `<= ${w.latencyBudgetMs.toLocaleString()} ms`,
      measuredHow: 'Control latency histogram under representative load.',
      blocksLaunch: w.actor === 'customer',
    },
  ];

  if (w.output.mustBeStructured) {
    metrics.push({
      name: 'Schema validity',
      threshold: '>= 99.5% first-pass',
      measuredHow: 'Validator rejection rate at the gateway.',
      blocksLaunch: true,
    });
  }
  if (w.actions.length > 0) {
    metrics.push({
      name: 'Unauthorised action rate',
      threshold: '0 — any occurrence is a launch blocker',
      measuredHow: 'Control compares every executed action against the declared tool allow-list and approval records.',
      blocksLaunch: true,
    });
  }
  if (pattern === 'bounded-agent' || pattern === 'autonomous-agent') {
    metrics.push({
      name: 'Loop containment',
      threshold: 'p99 turns per outcome within the configured cap',
      measuredHow: 'Control turn distribution per trace. A long tail here is a cost incident forming.',
      blocksLaunch: true,
    });
    metrics.push({
      name: 'Adversarial injection resistance',
      threshold: '0 successful tool invocations from injected instructions',
      measuredHow: 'Red-team suite run in CI on every prompt or tool change.',
      blocksLaunch: true,
    });
  }
  if (pattern === 'rag') {
    metrics.push({
      name: 'Retrieval hit rate',
      threshold: '>= 90% of answerable queries retrieve a sufficient passage',
      measuredHow: 'Annotated query set. Most "the model hallucinated" reports are actually retrieval misses.',
      blocksLaunch: true,
    });
    metrics.push({
      name: 'Permission leakage',
      threshold: '0 cross-boundary retrievals',
      measuredHow: 'Automated probes using accounts with deliberately restricted scope.',
      blocksLaunch: true,
    });
  }
  if (w.actor === 'self') {
    return {
      goldenSetSize: 10,
      metrics: [
        {
          name: 'Does it actually help?',
          threshold: 'Right 9 times out of 10 on things you can check',
          measuredHow: 'Try ten real examples where you already know the answer. Count the misses.',
          blocksLaunch: true,
        },
        {
          name: 'Time actually saved',
          threshold: 'Faster than doing it yourself, including the checking',
          measuredHow: 'Time yourself both ways for a week. Checking time counts.',
          blocksLaunch: false,
        },
      ],
      cadence: 'Re-check whenever the tool updates its model, which happens more often than announcements suggest.',
      humanBaselineNote: 'Compare against how well you do it now, not against perfection.',
      regressionPolicy: 'If it gets worse after an update, stop using it for anything you cannot verify.',
    };
  }

  return {
    goldenSetSize,
    metrics,
    cadence: 'Every deploy, every prompt change, every model version change, and weekly on live sampled traffic.',
    humanBaselineNote: w.current.humanErrorRate !== undefined
      ? `Today's process is wrong about ${(w.current.humanErrorRate * 100).toFixed(1)}% of the time. That is the bar — not zero.`
      : 'No human baseline was supplied. Measure it first, or you will hold the model to a standard the current process does not meet either.',
    regressionPolicy:
      'Pin model versions. Providers change model behaviour underneath a stable name; re-run the golden set before adopting any new version, and keep the ability to roll back.',
  };
}
