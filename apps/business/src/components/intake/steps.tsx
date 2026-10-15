'use client';

import { estimateTokens, type TaskShape } from '@ark/core';
import type { IntakeState, LatencyMs, Regime } from '@/lib/intake-state';
import { DATA_CLASS_GROUPS, REGIME_GROUPS, SHAPE_GROUPS } from './options';
import {
  ActionEditor, Area, ChipGroups, Choices, Field, NumInput, Section, TextInput, Toggle,
} from './primitives';

/**
 * The eight sections. Every field here exists because it changes an output:
 * nothing is collected to pad the form or to profile the company. Where a
 * question is uncomfortable to answer honestly — what the humans doing this
 * today get wrong, how much of the job AI actually removes — it is asked
 * anyway, because the alternative is a fabricated ROI.
 */

export type Setter = <K extends keyof IntakeState>(key: K, value: IntakeState[K]) => void;
interface StepProps { s: IntakeState; set: Setter }

const toggleIn = <T,>(xs: readonly T[], x: T): T[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

export function JobStep({ s, set }: StepProps) {
  return (
    <Section
      title="What is the job?"
      help="One repeating unit of work, not a department. “Triage inbound support tickets” — not “support”."
    >
      <Field label="Name">
        {(p) => <TextInput {...p} value={s.name} onChange={(v) => set('name', v)} placeholder="e.g. Triage inbound support tickets" />}
      </Field>
      <Field label="How it works today" hint="What a person does, start to finish. Two or three sentences." optional>
        {(p) => (
          <Area
            {...p}
            value={s.description}
            onChange={(v) => set('description', v)}
            rows={4}
            placeholder="e.g. A rep reads the ticket, decides which of six queues it belongs in, sets a priority, and writes a one-line summary for the queue owner."
          />
        )}
      </Field>
      <Choices
        label="Who the output is for"
        value={s.actor}
        onChange={(v) => set('actor', v)}
        options={[
          { id: 'employee', label: 'An employee', help: 'Internal. Mistakes stay in the building.' },
          { id: 'customer', label: 'A customer', help: 'External. Mistakes become incidents.' },
          { id: 'system', label: 'Another system', help: 'Machine-consumed. Output format is a contract.' },
        ]}
      />
      <ChipGroups<TaskShape>
        label="What shape is the work?"
        hint="Pick everything that applies."
        groups={SHAPE_GROUPS}
        selected={s.task}
        toggle={(id) => set('task', toggleIn(s.task, id))}
      />
    </Section>
  );
}

export function VolumeStep({ s, set }: StepProps) {
  return (
    <Section
      title="How much of it is there?"
      help="Volume decides almost everything downstream. Below a few hundred a month, the build cost rarely pays back and the report will say so."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Units per month" hint="Your count, not an estimate we supply.">
          {(p) => <NumInput {...p} value={s.unitsPerMonth} onChange={(v) => set('unitsPerMonth', v)} max={10_000_000} placeholder="e.g. 2,000" />}
        </Field>
        <Field label="What is a unit called?" hint="Used throughout the report.">
          {(p) => <TextInput {...p} value={s.unitLabel} onChange={(v) => set('unitLabel', v)} placeholder="e.g. ticket" />}
        </Field>
      </div>
      <Choices
        label="Arrival pattern"
        value={s.variability}
        onChange={(v) => set('variability', v)}
        options={[
          { id: 'steady', label: 'Steady', help: 'Roughly the same load every day.' },
          { id: 'bursty', label: 'Bursty', help: 'Long quiet stretches, sharp spikes. Changes the rate-limit and concurrency answer.' },
          { id: 'seasonal', label: 'Seasonal', help: 'Predictable peaks — month-end, launches, holidays.' },
        ]}
      />
    </Section>
  );
}

export function InputOutputStep({ s, set }: StepProps) {
  const est = s.promptPaste.trim().length > 0 ? estimateTokens(s.promptPaste).value : 0;
  return (
    <Section
      title="What goes in and what comes out?"
      help="Paste a typical prompt if you have one. The token count is a rule of thumb (about four characters per token), labelled heuristic, and you can still type the number directly — real prompts grow once the system prompt and retrieved context are counted."
    >
      <Field label="A typical prompt" hint="Optional. Used only to estimate input tokens. Nothing is stored." optional>
        {(p) => (
          <>
            <Area
              {...p}
              value={s.promptPaste}
              onChange={(v) => {
                set('promptPaste', v);
                const n = estimateTokens(v).value;
                if (n > 0) set('inTokens', n);
              }}
              rows={5}
              placeholder="Paste the prompt you would actually send, including any system instructions you already know about."
            />
            {est > 0 && (
              <p className="mt-2 font-mono text-2xs text-ink-300">
                ≈ {est.toLocaleString()} input tokens
                <span className="ml-2 text-ink-400">heuristic · 4 characters ≈ 1 token</span>
              </p>
            )}
          </>
        )}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Input tokens per unit" hint="Prompt, context, retrieved material. Edit if the paste is wrong.">
          {(p) => <NumInput {...p} value={s.inTokens} onChange={(v) => set('inTokens', v)} max={2_000_000} placeholder="e.g. 1,200" />}
        </Field>
        <Field label="Output tokens per unit" hint="Usually smaller, usually the expensive half.">
          {(p) => <NumInput {...p} value={s.outTokens} onChange={(v) => set('outTokens', v)} max={200_000} placeholder="e.g. 400" />}
        </Field>
      </div>
      <Field
        label="Systems it must read from"
        hint="Comma separated. Every one of these is an integration, a credential, and a way for this to break."
        optional
      >
        {(p) => <TextInput {...p} value={s.sourceSystems} onChange={(v) => set('sourceSystems', v)} placeholder="e.g. Zendesk, Postgres, Confluence" />}
      </Field>
      <Toggle
        on={s.requiresExternalKnowledge}
        set={(v) => set('requiresExternalKnowledge', v)}
        label="Answering requires knowledge that is not in the request"
        help="Your documents, current prices, this week's policy. If true, retrieval is a correctness requirement, not a nice-to-have."
      />
      <Toggle
        on={s.mustBeStructured}
        set={(v) => set('mustBeStructured', v)}
        label="The output must be machine-parseable"
        help="JSON, a specific schema, a field another system reads. Adds validation and a reject-and-retry path."
      />
    </Section>
  );
}

export function CorrectnessStep({ s, set }: StepProps) {
  return (
    <Section title="How wrong is it allowed to be?" help="This section decides the verdict more often than cost does.">
      <Choices
        label="How exact does the answer have to be?"
        value={s.determinism}
        onChange={(v) => set('determinism', v)}
        options={[
          { id: 'exact', label: 'One right answer', help: 'Verifiable, and either right or wrong. A model is usually the wrong tool for this.' },
          { id: 'tolerant', label: 'A band of acceptable answers', help: 'Several outputs would be fine.' },
          { id: 'subjective', label: 'Quality is a judgement call', help: 'Tone, style, usefulness. No key to grade against.' },
        ]}
      />
      <Choices
        label="What happens when it is wrong?"
        value={s.errorTolerance}
        onChange={(v) => set('errorTolerance', v)}
        options={[
          { id: 'none', label: 'Unacceptable', help: 'Safety, money movement, regulated advice.' },
          { id: 'low', label: 'Expensive', help: 'A customer is affected and someone has to fix it.' },
          { id: 'medium', label: 'Annoying', help: 'Caught downstream, corrected cheaply.' },
          { id: 'high', label: 'Cheap', help: 'A draft nobody sends without reading.' },
        ]}
      />
      <Toggle
        on={s.multiStep}
        set={(v) => set('multiStep', v)}
        label="The job needs several dependent steps, not one response"
        help="If the steps are known in advance, the answer is a workflow with model nodes — not an agent. That distinction is worth real money."
      />
    </Section>
  );
}

export function DataStep({ s, set }: StepProps) {
  return (
    <Section
      title="What data is involved, and what can it do?"
      help="This section drives the security controls and, if you give an agent write access, most of the risk score."
    >
      <ChipGroups
        label="Data classes in scope"
        hint="Pick every one that touches the prompt or the retrieved context."
        groups={DATA_CLASS_GROUPS}
        selected={s.dataClasses}
        toggle={(id) => set('dataClasses', toggleIn(s.dataClasses, id))}
      />
      <div>
        <p className="text-xs font-medium text-ink-200">Actions it would take in other systems</p>
        <p className="mt-1 max-w-2xl text-2xs leading-relaxed text-ink-400">
          Leave empty if it only produces text. Adding a write action is the single biggest change you can make to this report.
        </p>
        <div className="mt-2.5">
          <ActionEditor actions={s.actions} setActions={(a) => set('actions', a)} />
        </div>
      </div>
      <Choices
        label="How much rope does it get?"
        value={s.autonomy}
        onChange={(v) => set('autonomy', v)}
        options={[
          { id: 'suggest', label: 'Suggests', help: 'A person does the work. Fastest to ship, least risk.' },
          { id: 'approve', label: 'Prepares, human approves', help: 'It drafts the action; someone clicks yes.' },
          { id: 'bounded', label: 'Acts inside hard limits', help: 'Allow-listed tools, spend cap, turn cap.' },
          { id: 'full', label: 'Acts alone', help: 'Justifiable only when every action is cheap to undo.' },
        ]}
      />
    </Section>
  );
}

const LATENCY: { id: `${LatencyMs}`; label: string; help: string }[] = [
  { id: '1000', label: 'Under a second', help: 'Interactive. Rules out the largest models and most agent loops.' },
  { id: '5000', label: 'A few seconds', help: 'A person is waiting.' },
  { id: '30000', label: 'Up to half a minute', help: 'Acceptable for a considered answer.' },
  { id: '600000', label: 'Batch', help: 'Nobody is watching. Cheapest option — use batch pricing.' },
];

export function ConstraintsStep({ s, set }: StepProps) {
  return (
    <Section title="What constrains it?">
      <Choices
        label="Latency budget"
        hint="How long a user or system will wait for one unit."
        value={s.latencyBudgetMs === '' ? '' : (`${s.latencyBudgetMs}` as `${LatencyMs}`)}
        onChange={(v) => set('latencyBudgetMs', Number(v) as LatencyMs)}
        options={LATENCY}
      />
      <ChipGroups<Regime>
        label="Regulatory regimes"
        hint="Pick all that apply, or “None that I know of”."
        groups={REGIME_GROUPS}
        selected={s.regulated}
        columns={3}
        toggle={(id) => {
          if (id === 'none') return set('regulated', ['none']);
          const next = toggleIn(s.regulated.filter((x) => x !== 'none'), id);
          set('regulated', next.length ? next : ['none']);
        }}
      />
      <Choices
        label="Where the data is allowed to be processed"
        value={s.dataResidency}
        onChange={(v) => set('dataResidency', v)}
        options={[
          { id: 'any', label: 'Anywhere', help: 'No residency constraint.' },
          { id: 'us', label: 'United States' },
          { id: 'eu', label: 'European Union' },
          { id: 'on_prem', label: 'On our own infrastructure', help: 'Rules out every hosted frontier API. Changes the model shortlist entirely.' },
        ]}
      />
    </Section>
  );
}

export function TodayStep({ s, set }: StepProps) {
  return (
    <Section
      title="What does this cost you today?"
      help={
        <>
          <strong className="font-medium text-ink-200">Optional — leave blank if you don’t know.</strong>{' '}
          The report will then say the ROI is unknowable rather than invent a denominator — which is the honest
          outcome, and more useful than a confident fiction.
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Minutes a person spends per unit" optional>
          {(p) => <NumInput {...p} value={s.minutesPerUnit} onChange={(v) => set('minutesPerUnit', v)} max={2000} suffix="min" placeholder="unknown" />}
        </Field>
        <Field label="Fully loaded hourly cost" hint="Salary plus benefits, tax and overhead — not the wage." optional>
          {(p) => <NumInput {...p} value={s.hourlyUsd} onChange={(v) => set('hourlyUsd', v)} max={1000} suffix="$/h" placeholder="unknown" />}
        </Field>
      </div>
      <Field
        label="How often the humans get it wrong today"
        hint="The number almost nobody measures. Without it, an AI accuracy figure has nothing to be compared against, and “93% accurate” sounds like a result rather than a question."
        optional
      >
        {(p) => <NumInput {...p} value={s.humanErrorRate} onChange={(v) => set('humanErrorRate', v)} max={100} suffix="%" placeholder="unknown" />}
      </Field>
    </Section>
  );
}

export function TeamStep({ s, set }: StepProps) {
  return (
    <Section
      title="Who would own it?"
      help="These four answers change the architecture recommendation. A two-person team gets a different plan from a twenty-person one, and pretending otherwise is how small teams end up operating an agent framework at 2am."
    >
      <Field label="Engineers who could work on this" hint="0 is an answer: it means nobody has the time.">
        {(p) => <NumInput {...p} value={s.engineers} onChange={(v) => set('engineers', v === '' ? '' : Math.round(v))} max={500} />}
      </Field>
      <Toggle
        on={s.hasMlExperience}
        set={(v) => set('hasMlExperience', v)}
        label="Someone here has shipped and operated an ML or LLM system before"
        help="Not “has used ChatGPT”. Has been on call for one."
      />
      <Toggle
        on={s.hasSecurityReview}
        set={(v) => set('hasSecurityReview', v)}
        label="We have a security review process this would go through"
      />
      <Toggle
        on={s.canOperate247}
        set={(v) => set('canOperate247', v)}
        label="We can respond to a production problem outside business hours"
        help="If not, autonomous patterns are off the table regardless of what the data says."
      />
    </Section>
  );
}

export const STEPS = [JobStep, VolumeStep, InputOutputStep, CorrectnessStep, DataStep, ConstraintsStep, TodayStep, TeamStep];
