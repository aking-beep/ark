'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { encodeWorkloadClient } from '@/lib/encode';
import { estimateTokens } from '@ark/core';

/**
 * The business intake.
 *
 * Eight sections, about thirty answers. Every field here exists because it
 * changes an output: nothing is collected to pad the form or to profile the
 * company. Where a question is uncomfortable to answer honestly — what the
 * humans doing this today get wrong, how much of the job AI actually removes —
 * it is asked anyway, because the alternative is a fabricated ROI.
 */

type Shape =
  | 'classify' | 'extract' | 'summarize' | 'generate' | 'converse'
  | 'search' | 'decide' | 'act' | 'calculate' | 'lookup';

const SHAPES: { id: Shape; label: string; eg: string }[] = [
  { id: 'classify', label: 'Classify', eg: 'route, tag, triage, score' },
  { id: 'extract', label: 'Extract', eg: 'pull fields out of unstructured input' },
  { id: 'summarize', label: 'Summarise', eg: 'compress long material' },
  { id: 'generate', label: 'Generate', eg: 'draft prose, code, replies' },
  { id: 'converse', label: 'Converse', eg: 'multi-turn dialogue with a person' },
  { id: 'search', label: 'Search', eg: 'find material in a corpus' },
  { id: 'decide', label: 'Decide', eg: 'choose among options with consequences' },
  { id: 'act', label: 'Act', eg: 'take an action in another system' },
  { id: 'calculate', label: 'Calculate', eg: 'deterministic arithmetic or logic' },
  { id: 'lookup', label: 'Look up', eg: 'fetch a known record by key' },
];

const DATA_CLASSES: { id: string; label: string; help: string }[] = [
  { id: 'public', label: 'Public', help: 'Already published. No disclosure risk.' },
  { id: 'internal', label: 'Internal', help: 'Not secret, not for outsiders.' },
  { id: 'pii', label: 'Personal data', help: 'Names, emails, addresses, identifiers.' },
  { id: 'sensitive_pii', label: 'Sensitive personal data', help: 'Government ID, biometrics.' },
  { id: 'phi', label: 'Health data', help: 'Anything that makes this HIPAA-shaped.' },
  { id: 'pci', label: 'Cardholder data', help: 'PANs, CVVs, anything in PCI scope.' },
  { id: 'financial', label: 'Financial', help: 'Balances, transactions, payroll.' },
  { id: 'credentials', label: 'Credentials', help: 'Keys, tokens, passwords.' },
  { id: 'trade_secret', label: 'Trade secret', help: 'Source, formulas, unreleased strategy.' },
  { id: 'minors', label: 'Data about minors', help: 'People under 18.' },
];

const REGIMES: { id: string; label: string }[] = [
  { id: 'none', label: 'None that I know of' },
  { id: 'hipaa', label: 'HIPAA' },
  { id: 'pci', label: 'PCI DSS' },
  { id: 'gdpr', label: 'GDPR' },
  { id: 'ccpa', label: 'CCPA/CPRA' },
  { id: 'sox', label: 'SOX' },
  { id: 'ferpa', label: 'FERPA' },
  { id: 'glba', label: 'GLBA' },
  { id: 'eu_ai_act', label: 'EU AI Act' },
];

interface Action {
  name: string;
  system: string;
  write: boolean;
  blastRadius: 'none' | 'reversible' | 'costly' | 'irreversible';
  valueCeilingUsd?: number;
}

const SECTIONS = [
  'The job',
  'Volume',
  'Input and output',
  'Correctness',
  'Data and actions',
  'Constraints',
  'Today',
  'Your team',
];

export function Intake() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // 1. the job
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [actor, setActor] = useState<'employee' | 'customer' | 'system'>('employee');
  const [task, setTask] = useState<Shape[]>([]);

  // 2. volume
  const [unitsPerMonth, setUnits] = useState(2000);
  const [unitLabel, setUnitLabel] = useState('ticket');
  const [variability, setVariability] = useState<'steady' | 'bursty' | 'seasonal'>('steady');

  // 3. input / output
  const [inTokens, setInTokens] = useState(1200);
  const [outTokens, setOutTokens] = useState(400);
  const [promptPaste, setPromptPaste] = useState('');
  const [sourceSystems, setSourceSystems] = useState('');
  const [requiresExternalKnowledge, setExternal] = useState(false);
  const [mustBeStructured, setStructured] = useState(false);

  // 4. correctness
  const [determinism, setDeterminism] = useState<'exact' | 'tolerant' | 'subjective'>('tolerant');
  const [errorTolerance, setTolerance] = useState<'none' | 'low' | 'medium' | 'high'>('medium');
  const [multiStep, setMultiStep] = useState(false);

  // 5. data and actions
  const [dataClasses, setDataClasses] = useState<string[]>(['internal']);
  const [actions, setActions] = useState<Action[]>([]);
  const [autonomy, setAutonomy] = useState<'suggest' | 'approve' | 'bounded' | 'full'>('suggest');

  // 6. constraints
  const [latencyBudgetMs, setLatency] = useState(10000);
  const [regulated, setRegulated] = useState<string[]>(['none']);
  const [dataResidency, setResidency] = useState<'any' | 'us' | 'eu' | 'on_prem'>('any');

  // 7. today
  const [minutesPerUnit, setMinutes] = useState<number | ''>('');
  const [hourlyUsd, setHourly] = useState<number | ''>('');
  const [humanErrorRate, setHumanError] = useState<number | ''>('');

  // 8. team
  const [engineers, setEngineers] = useState(2);
  const [hasMlExperience, setMl] = useState(false);
  const [hasSecurityReview, setSec] = useState(false);
  const [canOperate247, setOps] = useState(false);

  const canAdvance = useMemo(() => {
    if (step === 0) return name.trim().length > 1 && task.length > 0;
    if (step === 1) return unitsPerMonth > 0 && unitLabel.trim().length > 0;
    if (step === 2) return inTokens > 0 && outTokens > 0;
    if (step === 4) return dataClasses.length > 0;
    return true;
  }, [step, name, task, unitsPerMonth, unitLabel, inTokens, outTokens, dataClasses]);

  function submit() {
    const workload = {
      id: `w_${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim(),
      actor,
      task,
      volume: { unitsPerMonth, unitLabel: unitLabel.trim() || 'task', variability },
      input: {
        modality: ['text'],
        avgTokens: inTokens,
        sourceSystems: sourceSystems.split(',').map((s) => s.trim()).filter(Boolean),
        requiresExternalKnowledge,
      },
      output: { modality: ['text'], avgTokens: outTokens, mustBeStructured },
      determinism,
      errorTolerance,
      multiStep,
      dataClasses,
      actions,
      autonomy,
      latencyBudgetMs,
      regulated: regulated.length ? regulated : ['none'],
      dataResidency,
      current: {
        ...(minutesPerUnit === '' ? {} : { minutesPerUnit }),
        ...(hourlyUsd === '' ? {} : { fullyLoadedHourlyUsd: hourlyUsd }),
        ...(humanErrorRate === '' ? {} : { humanErrorRate: humanErrorRate / 100 }),
      },
      team: { engineers, hasMlExperience, hasSecurityReview, canOperate247 },
    };
    router.push(`/report?w=${encodeWorkloadClient(workload)}`);
  }

  return (
    <div>
      <ol className="mb-8 flex flex-wrap gap-x-4 gap-y-1 text-2xs">
        {SECTIONS.map((s, i) => (
          <li
            key={s}
            className={
              i === step ? 'text-signal' : i < step ? 'text-ink-400' : 'text-ink-600'
            }
          >
            <span className="font-mono">{i + 1}.</span> {s}
          </li>
        ))}
      </ol>

      <div className="mb-8 flex items-center gap-1.5">
        {SECTIONS.map((s, i) => (
          <div
            key={s}
            className={'h-1 flex-1 rounded-full transition ' + (i <= step ? 'bg-signal' : 'bg-ink-800')}
          />
        ))}
      </div>

      {step === 0 && (
        <Section
          title="What is the job?"
          help="One repeating unit of work, not a department. “Triage inbound support tickets” — not “support”."
        >
          <Field label="Name">
            <Text value={name} onChange={setName} placeholder="Triage inbound support tickets" autoFocus />
          </Field>
          <Field label="How it works today" hint="What a person does, start to finish. Two or three sentences.">
            <Area
              value={description}
              onChange={setDescription}
              rows={4}
              placeholder="A rep reads the ticket, decides which of six queues it belongs in, sets a priority, and writes a one-line summary for the queue owner."
            />
          </Field>
          <Field label="Who the output is for">
            <Choices
              value={actor}
              onChange={setActor}
              options={[
                { id: 'employee', label: 'An employee', help: 'Internal. Mistakes stay in the building.' },
                { id: 'customer', label: 'A customer', help: 'External. Mistakes become incidents.' },
                { id: 'system', label: 'Another system', help: 'Machine-consumed. Output format is a contract.' },
              ]}
            />
          </Field>
          <Field
            label="What shape is the work?"
            hint="Pick everything that applies. If the only things you pick are Calculate and Look up, this report will tell you not to use a model — and it will be right."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {SHAPES.map((s) => (
                <Chip
                  key={s.id}
                  on={task.includes(s.id)}
                  onClick={() =>
                    setTask(task.includes(s.id) ? task.filter((t) => t !== s.id) : [...task, s.id])
                  }
                  label={s.label}
                  help={s.eg}
                />
              ))}
            </div>
          </Field>
        </Section>
      )}

      {step === 1 && (
        <Section
          title="How much of it is there?"
          help="Volume decides almost everything downstream. Below a few hundred a month, the build cost rarely pays back and the report will say so."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Units per month">
              <Num value={unitsPerMonth} onChange={setUnits} min={1} max={10_000_000} />
            </Field>
            <Field label="What is a unit called?" hint="Used throughout the report.">
              <Text value={unitLabel} onChange={setUnitLabel} placeholder="ticket" />
            </Field>
          </div>
          <Field label="Arrival pattern">
            <Choices
              value={variability}
              onChange={setVariability}
              options={[
                { id: 'steady', label: 'Steady', help: 'Roughly the same load every day.' },
                { id: 'bursty', label: 'Bursty', help: 'Long quiet stretches, sharp spikes. Changes the rate-limit and concurrency answer.' },
                { id: 'seasonal', label: 'Seasonal', help: 'Predictable peaks — month-end, launches, holidays.' },
              ]}
            />
          </Field>
        </Section>
      )}

      {step === 2 && (
        <Section
          title="What goes in and what comes out?"
          help="Paste a typical prompt if you have one. The token count is a rule of thumb (about four characters per token), labelled heuristic, and you can still type the number directly — real prompts grow once the system prompt and retrieved context are counted."
        >
          <Field
            label="A typical prompt"
            hint="Optional. Used only to estimate input tokens. Nothing is stored."
          >
            <Area
              value={promptPaste}
              onChange={(v) => {
                setPromptPaste(v);
                const est = estimateTokens(v);
                if (est.value > 0) setInTokens(est.value);
              }}
              rows={5}
              placeholder="Paste the prompt you would actually send, including any system instructions you already know about."
            />
            {promptPaste.trim().length > 0 && (
              <p className="mt-2 font-mono text-2xs text-ink-500">
                ≈ {estimateTokens(promptPaste).value.toLocaleString()} input tokens
                <span className="ml-2 text-ink-600">heuristic · 4 characters ≈ 1 token</span>
              </p>
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Input tokens per unit" hint="Prompt, context, retrieved material. Edit if the paste is wrong.">
              <Num value={inTokens} onChange={setInTokens} min={1} max={2_000_000} />
            </Field>
            <Field label="Output tokens per unit" hint="Usually smaller, usually the expensive half.">
              <Num value={outTokens} onChange={setOutTokens} min={1} max={200_000} />
            </Field>
          </div>
          <Field
            label="Systems it must read from"
            hint="Comma separated. Every one of these is an integration, a credential, and a way for this to break."
          >
            <Text value={sourceSystems} onChange={setSourceSystems} placeholder="Zendesk, Postgres, Confluence" />
          </Field>
          <Toggle
            on={requiresExternalKnowledge}
            set={setExternal}
            label="Answering requires knowledge that is not in the request"
            help="Your documents, current prices, this week's policy. If true, retrieval is a correctness requirement, not a nice-to-have."
          />
          <Toggle
            on={mustBeStructured}
            set={setStructured}
            label="The output must be machine-parseable"
            help="JSON, a specific schema, a field another system reads. Adds validation and a reject-and-retry path."
          />
        </Section>
      )}

      {step === 3 && (
        <Section title="How wrong is it allowed to be?" help="This section decides the verdict more often than cost does.">
          <Field label="How exact does the answer have to be?">
            <Choices
              value={determinism}
              onChange={setDeterminism}
              options={[
                { id: 'exact', label: 'One right answer', help: 'Verifiable, and either right or wrong. A model is usually the wrong tool for this.' },
                { id: 'tolerant', label: 'A band of acceptable answers', help: 'Several outputs would be fine.' },
                { id: 'subjective', label: 'Quality is a judgement call', help: 'Tone, style, usefulness. No key to grade against.' },
              ]}
            />
          </Field>
          <Field label="What happens when it is wrong?">
            <Choices
              value={errorTolerance}
              onChange={setTolerance}
              options={[
                { id: 'none', label: 'Unacceptable', help: 'Safety, money movement, regulated advice.' },
                { id: 'low', label: 'Expensive', help: 'A customer is affected and someone has to fix it.' },
                { id: 'medium', label: 'Annoying', help: 'Caught downstream, corrected cheaply.' },
                { id: 'high', label: 'Cheap', help: 'A draft nobody sends without reading.' },
              ]}
            />
          </Field>
          <Toggle
            on={multiStep}
            set={setMultiStep}
            label="The job needs several dependent steps, not one response"
            help="If the steps are known in advance, the answer is a workflow with model nodes — not an agent. That distinction is worth real money."
          />
        </Section>
      )}

      {step === 4 && (
        <Section
          title="What data is involved, and what can it do?"
          help="This section drives the security controls and, if you give an agent write access, most of the risk score."
        >
          <Field label="Data classes in scope" hint="Pick every one that touches the prompt or the retrieved context.">
            <div className="grid gap-2 sm:grid-cols-2">
              {DATA_CLASSES.map((d) => (
                <Chip
                  key={d.id}
                  on={dataClasses.includes(d.id)}
                  onClick={() =>
                    setDataClasses(
                      dataClasses.includes(d.id)
                        ? dataClasses.filter((x) => x !== d.id)
                        : [...dataClasses, d.id],
                    )
                  }
                  label={d.label}
                  help={d.help}
                />
              ))}
            </div>
          </Field>

          <Field
            label="Actions it would take in other systems"
            hint="Leave empty if it only produces text. Adding a write action is the single biggest change you can make to this report."
          >
            <ActionEditor actions={actions} setActions={setActions} />
          </Field>

          <Field label="How much rope does it get?">
            <Choices
              value={autonomy}
              onChange={setAutonomy}
              options={[
                { id: 'suggest', label: 'Suggests', help: 'A person does the work. Fastest to ship, least risk.' },
                { id: 'approve', label: 'Prepares, human approves', help: 'It drafts the action; someone clicks yes.' },
                { id: 'bounded', label: 'Acts inside hard limits', help: 'Allow-listed tools, spend cap, turn cap.' },
                { id: 'full', label: 'Acts alone', help: 'Justifiable only when every action is cheap to undo.' },
              ]}
            />
          </Field>
        </Section>
      )}

      {step === 5 && (
        <Section title="What constrains it?">
          <Field label="Latency budget" hint="How long a user or system will wait for one unit.">
            <Choices
              value={String(latencyBudgetMs)}
              onChange={(v: string) => setLatency(Number(v))}
              options={[
                { id: '1000', label: 'Under a second', help: 'Interactive. Rules out the largest models and most agent loops.' },
                { id: '5000', label: 'A few seconds', help: 'A person is waiting.' },
                { id: '30000', label: 'Up to half a minute', help: 'Acceptable for a considered answer.' },
                { id: '600000', label: 'Batch', help: 'Nobody is watching. Cheapest option — use batch pricing.' },
              ]}
            />
          </Field>
          <Field label="Regulatory regimes" hint="Pick all that apply, or “none that I know of”.">
            <div className="grid gap-2 sm:grid-cols-3">
              {REGIMES.map((r) => (
                <Chip
                  key={r.id}
                  on={regulated.includes(r.id)}
                  onClick={() => {
                    if (r.id === 'none') return setRegulated(['none']);
                    const next = regulated.filter((x) => x !== 'none');
                    setRegulated(
                      next.includes(r.id) ? next.filter((x) => x !== r.id) : [...next, r.id],
                    );
                  }}
                  label={r.label}
                />
              ))}
            </div>
          </Field>
          <Field label="Where the data is allowed to be processed">
            <Choices
              value={dataResidency}
              onChange={setResidency}
              options={[
                { id: 'any', label: 'Anywhere', help: 'No residency constraint.' },
                { id: 'us', label: 'United States' },
                { id: 'eu', label: 'European Union' },
                { id: 'on_prem', label: 'On our own infrastructure', help: 'Rules out every hosted frontier API. Changes the model shortlist entirely.' },
              ]}
            />
          </Field>
        </Section>
      )}

      {step === 6 && (
        <Section
          title="What does this cost you today?"
          help="Leave a field blank if you genuinely do not know. The report will say the ROI is unknowable rather than invent a denominator — which is the honest outcome, and more useful than a confident fiction."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Minutes a person spends per unit">
              <NumOrBlank value={minutesPerUnit} onChange={setMinutes} min={0} max={2000} suffix="min" />
            </Field>
            <Field label="Fully loaded hourly cost" hint="Salary plus benefits, tax and overhead — not the wage.">
              <NumOrBlank value={hourlyUsd} onChange={setHourly} min={0} max={1000} suffix="$/h" />
            </Field>
          </div>
          <Field
            label="How often the humans get it wrong today"
            hint="The number almost nobody measures. Without it, an AI accuracy figure has nothing to be compared against, and “93% accurate” sounds like a result rather than a question."
          >
            <NumOrBlank value={humanErrorRate} onChange={setHumanError} min={0} max={100} suffix="%" />
          </Field>
        </Section>
      )}

      {step === 7 && (
        <Section
          title="Who would own it?"
          help="These four answers change the architecture recommendation. A two-person team gets a different plan from a twenty-person one, and pretending otherwise is how small teams end up operating an agent framework at 2am."
        >
          <Field label="Engineers who could work on this">
            <Num value={engineers} onChange={setEngineers} min={0} max={500} />
          </Field>
          <Toggle
            on={hasMlExperience}
            set={setMl}
            label="Someone here has shipped and operated an ML or LLM system before"
            help="Not “has used ChatGPT”. Has been on call for one."
          />
          <Toggle
            on={hasSecurityReview}
            set={setSec}
            label="We have a security review process this would go through"
          />
          <Toggle
            on={canOperate247}
            set={setOps}
            label="We can respond to a production problem outside business hours"
            help="If not, autonomous patterns are off the table regardless of what the data says."
          />
        </Section>
      )}

      <div className="mt-10 flex items-center justify-between border-t border-ink-800 pt-6">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="text-sm text-ink-500 transition hover:text-ink-300 disabled:opacity-30"
        >
          Back
        </button>
        <div className="flex items-center gap-4">
          <span className="text-2xs text-ink-600">
            {step + 1} of {SECTIONS.length}
          </span>
          <button
            type="button"
            disabled={!canAdvance}
            onClick={() => (step === SECTIONS.length - 1 ? submit() : setStep((s) => s + 1))}
            className="rounded-lg bg-signal px-5 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-signal-glow disabled:bg-ink-700 disabled:text-ink-500"
          >
            {step === SECTIONS.length - 1 ? 'Generate the report' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form primitives. Local to this app: the shared package deliberately  */
/* carries no form controls, because the three surfaces disagree about  */
/* how much to ask and that disagreement should not leak into @ark/ui.  */
/* ------------------------------------------------------------------ */

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold leading-snug text-ink-100">{title}</h1>
      {help && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-400">{help}</p>}
      <div className="mt-7 space-y-6">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-200">{label}</p>
      {hint && <p className="mt-1 max-w-2xl text-2xs leading-relaxed text-ink-500">{hint}</p>}
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

const INPUT =
  'w-full rounded-lg border border-ink-700 bg-ink-850 px-4 py-2.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-signal focus:outline-none';

function Text({
  value, onChange, placeholder, autoFocus,
}: { value: string; onChange: (s: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <input
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={INPUT}
    />
  );
}

function Area({
  value, onChange, placeholder, rows = 3,
}: { value: string; onChange: (s: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={INPUT + ' resize-none leading-relaxed'}
    />
  );
}

function Num({
  value, onChange, min, max,
}: { value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      className={INPUT + ' font-mono'}
    />
  );
}

function NumOrBlank({
  value, onChange, min, max, suffix,
}: {
  value: number | '';
  onChange: (n: number | '') => void;
  min: number; max: number; suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        placeholder="unknown"
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange('');
          onChange(Math.max(min, Math.min(max, Number(raw))));
        }}
        className={INPUT + ' font-mono'}
      />
      {suffix && <span className="shrink-0 font-mono text-2xs text-ink-500">{suffix}</span>}
    </div>
  );
}

function Chip({
  on, onClick, label, help,
}: { on: boolean; onClick: () => void; label: string; help?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-lg border px-3.5 py-2.5 text-left transition ' +
        (on ? 'border-signal bg-signal/10 text-ink-100' : 'border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600')
      }
    >
      <span className="block text-xs">{label}</span>
      {help && <span className="mt-0.5 block text-2xs leading-relaxed text-ink-500">{help}</span>}
    </button>
  );
}

function Choices<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: string; label: string; help?: string }[];
}) {
  return (
    <div className="space-y-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id as T)}
          className={
            'w-full rounded-lg border px-4 py-2.5 text-left transition ' +
            (value === o.id
              ? 'border-signal bg-signal/10 text-ink-100'
              : 'border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600')
          }
        >
          <span className="block text-sm">{o.label}</span>
          {o.help && <span className="mt-0.5 block text-2xs leading-relaxed text-ink-500">{o.help}</span>}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  on, set, label, help,
}: { on: boolean; set: (b: boolean) => void; label: string; help?: string }) {
  return (
    <button
      type="button"
      onClick={() => set(!on)}
      className={
        'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition ' +
        (on ? 'border-signal bg-signal/10' : 'border-ink-700 bg-ink-850 hover:border-ink-600')
      }
    >
      <span
        className={
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-2xs ' +
          (on ? 'border-signal bg-signal text-ink-950' : 'border-ink-600')
        }
      >
        {on ? '\u2713' : ''}
      </span>
      <span>
        <span className={'block text-sm ' + (on ? 'text-ink-100' : 'text-ink-300')}>{label}</span>
        {help && <span className="mt-0.5 block text-2xs leading-relaxed text-ink-500">{help}</span>}
      </span>
    </button>
  );
}

function ActionEditor({
  actions, setActions,
}: { actions: Action[]; setActions: (a: Action[]) => void }) {
  function update(i: number, patch: Partial<Action>) {
    setActions(actions.map((a, n) => (n === i ? { ...a, ...patch } : a)));
  }

  return (
    <div className="space-y-3">
      {actions.map((a, i) => (
        <div key={i} className="rounded-lg border border-ink-700 bg-ink-850 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={a.name}
              placeholder="refund_order"
              onChange={(e) => update(i, { name: e.target.value })}
              className={INPUT + ' font-mono text-xs'}
            />
            <input
              value={a.system}
              placeholder="Stripe"
              onChange={(e) => update(i, { system: e.target.value })}
              className={INPUT + ' text-xs'}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => update(i, { write: !a.write })}
              className={
                'rounded-md border px-2.5 py-1 text-2xs transition ' +
                (a.write ? 'border-warn bg-warn/10 text-warn' : 'border-ink-600 text-ink-400')
              }
            >
              {a.write ? 'writes' : 'read only'}
            </button>
            {(['none', 'reversible', 'costly', 'irreversible'] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => update(i, { blastRadius: b })}
                className={
                  'rounded-md border px-2.5 py-1 text-2xs transition ' +
                  (a.blastRadius === b
                    ? b === 'irreversible'
                      ? 'border-danger bg-danger/10 text-danger'
                      : 'border-signal bg-signal/10 text-ink-100'
                    : 'border-ink-700 text-ink-500 hover:border-ink-600')
                }
              >
                {b}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActions(actions.filter((_, n) => n !== i))}
              className="ml-auto text-2xs text-ink-600 transition hover:text-danger"
            >
              remove
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setActions([...actions, { name: '', system: '', write: false, blastRadius: 'reversible' }])
        }
        className="rounded-lg border border-dashed border-ink-700 px-4 py-2.5 text-xs text-ink-400 transition hover:border-ink-600 hover:text-ink-200"
      >
        + Add an action
      </button>
    </div>
  );
}
