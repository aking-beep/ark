import { Workload } from '../schema/workload.js';
import { Pattern } from './architecture.js';
import { Verdict } from './suitability.js';

export interface Phase {
  name: string;
  durationWeeks: number;
  goal: string;
  exitCriteria: string[];
  killCriteria: string;
}

/**
 * Every phase carries a kill criterion. A roadmap without one is a commitment
 * device, not a plan — and the ability to stop cheaply is most of the value of
 * sequencing the work at all.
 */
export function roadmap(w: Workload, pattern: Pattern, verdict: Verdict): Phase[] {
  if (verdict === 'not-ai') {
    return [{
      name: 'Build the deterministic version',
      durationWeeks: 2,
      goal: 'Solve the job with rules and queries, and log the cases the rules cannot handle.',
      exitCriteria: [
        'The rules cover the documented cases',
        'An exception queue captures everything they do not',
        'Four weeks of exception volume has been collected',
      ],
      killCriteria: 'If the exception queue stays under 5% of volume, there is no AI project here. That is a good outcome.',
    }];
  }

  const small = w.team.engineers <= 2;
  const phases: Phase[] = [];

  phases.push({
    name: 'Phase 0 — Measure the baseline',
    durationWeeks: 1,
    goal: 'Establish what the job costs and how often it is wrong today.',
    exitCriteria: [
      'Time per unit, measured on at least 10 real examples',
      'Current error rate from a sample of completed work',
      `Golden set of labelled examples assembled`,
      'Named business owner who will accept or reject the result',
    ],
    killCriteria: 'If nobody will own the accuracy bar, stop. There is no way to finish a project whose definition of done is unowned.',
  });

  phases.push({
    name: 'Phase 1 — Offline proof',
    durationWeeks: small ? 2 : 1,
    goal: 'Run the golden set through the candidate model with no integration at all.',
    exitCriteria: [
      'Accuracy meets the threshold on the holdout set',
      'Cost per outcome measured on real inputs, not estimated',
      'A cheaper model has been tried and its quality delta recorded',
    ],
    killCriteria: 'If accuracy misses the bar on curated examples with no integration friction, it will not improve once real data and latency arrive. Stop here — you have spent two weeks, not two quarters.',
  });

  if (pattern !== 'deterministic-automation') {
    phases.push({
      name: 'Phase 2 — Shadow mode',
      durationWeeks: 3,
      goal: 'Run against live traffic, produce real outputs, change nothing in the real world.',
      exitCriteria: [
        'Accuracy holds on live traffic within 5 points of the offline result',
        'Cost per successful outcome within 20% of the model',
        'ARK Control instrumented and attributing every call to this workload',
        'Failure modes catalogued from actual production inputs',
      ],
      killCriteria: 'A drop of more than 10 points from offline to live means the golden set was not representative. Rebuild it before writing more code.',
    });
  }

  const gated = w.actions.some((a) => a.blastRadius !== 'none' && a.blastRadius !== 'reversible');
  phases.push({
    name: 'Phase 3 — Assisted launch',
    durationWeeks: 4,
    goal: 'A person reviews every output. Capture every accept, edit and reject.',
    exitCriteria: [
      'Acceptance rate above 90% for two consecutive weeks',
      'Edit patterns analysed and fed back into the prompt or retrieval layer',
      'Reviewers report it saves time rather than creating review work',
      'Blocking security controls verified in production',
    ],
    killCriteria: 'If reviewers are editing more than a third of outputs, you have moved work rather than removed it. Go back to Phase 1.',
  });

  if (verdict === 'automate-bounded' || verdict === 'automate') {
    phases.push({
      name: 'Phase 4 — Bounded autonomy',
      durationWeeks: 6,
      goal: 'Release the confident majority; keep humans on the uncertain tail and anything consequential.',
      exitCriteria: [
        'Confidence threshold calibrated against the review data from Phase 3',
        `Spend ceiling and circuit breaker live${gated ? ', approval gate enforced on consequential actions' : ''}`,
        'Rollback to assisted mode is one config change and has been rehearsed',
        'Weekly accuracy sampling in place on live traffic',
      ],
      killCriteria: 'Any unauthorised action, or two consecutive weeks below the accuracy bar, reverts to assisted mode automatically.',
    });
  }

  if (!w.team.hasSecurityReview && w.dataClasses.some((d) => d !== 'public' && d !== 'internal')) {
    phases.splice(1, 0, {
      name: 'Phase 0.5 — Security review',
      durationWeeks: 1,
      goal: 'Get the data flow reviewed before it exists, not after.',
      exitCriteria: ['Data flow diagram approved', 'Provider terms and retention reviewed', 'Redaction approach agreed'],
      killCriteria: 'If sensitive data cannot lawfully leave your boundary, the answer is local inference or no project. Better to learn that in week one.',
    });
  }

  return phases;
}
