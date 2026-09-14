'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { encodeIntakeClient } from '@/lib/encode';

/**
 * Six questions in plain language. Each one maps onto a field the business
 * engine already understands, so this is a genuinely narrower intake rather
 * than a separate, weaker product.
 */

const SHAPES = [
  { id: 'generate', label: 'Writing something new', eg: 'emails, posts, first drafts' },
  { id: 'summarize', label: 'Shortening something long', eg: 'notes, articles, transcripts' },
  { id: 'classify', label: 'Sorting or labelling things', eg: 'tagging, triaging, prioritising' },
  { id: 'extract', label: 'Pulling details out of documents', eg: 'dates, totals, names' },
  { id: 'search', label: 'Finding things in a pile of material', eg: 'notes, files, past emails' },
  { id: 'converse', label: 'Back-and-forth conversation', eg: 'coaching, practice, tutoring' },
  { id: 'decide', label: 'Choosing between options', eg: 'which one, what next' },
  { id: 'calculate', label: 'Doing maths', eg: 'totals, budgets, conversions' },
  { id: 'lookup', label: 'Looking up a specific known answer', eg: 'a balance, an order status' },
] as const;

const STEPS = 6;

export function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [task, setTask] = useState<string[]>([]);
  const [timesPerMonth, setTimes] = useState(20);
  const [minutesEach, setMinutes] = useState(15);
  const [involvesPersonalData, setPersonal] = useState(false);
  const [involvesMoneyOrLegal, setMoney] = useState(false);
  const [needsExactAnswer, setExact] = useState(false);
  const [needsCurrentInfo, setCurrent] = useState(false);
  const [wouldNoticeIfWrong, setNotice] = useState<'immediately' | 'eventually' | 'never'>('eventually');

  const canAdvance = useMemo(() => {
    if (step === 0) return name.trim().length > 1;
    if (step === 1) return task.length > 0;
    if (step === 2) return timesPerMonth > 0 && minutesEach > 0;
    return true;
  }, [step, name, task, timesPerMonth, minutesEach]);

  function submit() {
    const encoded = encodeIntakeClient({
      id: `c_${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim(),
      task,
      timesPerMonth,
      minutesEach,
      involvesPersonalData,
      involvesMoneyOrLegal,
      needsExactAnswer,
      needsCurrentInfo,
      wouldNoticeIfWrong,
    });
    router.push(`/result?i=${encoded}`);
  }

  return (
    <div>
      <div className="mb-8 flex items-center gap-2">
        {Array.from({ length: STEPS }).map((_, i) => (
          <div
            key={i}
            className={
              'h-1 flex-1 rounded-full transition ' + (i <= step ? 'bg-signal' : 'bg-ink-800')
            }
          />
        ))}
      </div>

      {step === 0 && (
        <Question
          title="What is the task?"
          help="One specific thing you do repeatedly. Not &ldquo;marketing&rdquo; — something like &ldquo;write the weekly update email to clients&rdquo;."
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Write the weekly client update email"
            className="w-full rounded-lg border border-ink-700 bg-ink-850 px-4 py-3 text-base text-ink-100 placeholder:text-ink-600 focus:border-signal focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional: a sentence about how you do it today."
            rows={3}
            className="mt-3 w-full resize-none rounded-lg border border-ink-700 bg-ink-850 px-4 py-3 text-sm text-ink-200 placeholder:text-ink-600 focus:border-signal focus:outline-none"
          />
        </Question>
      )}

      {step === 1 && (
        <Question title="What kind of work is it?" help="Pick everything that applies.">
          <div className="grid gap-2 sm:grid-cols-2">
            {SHAPES.map((s) => {
              const on = task.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setTask(on ? task.filter((t) => t !== s.id) : [...task, s.id])}
                  className={
                    'rounded-lg border px-4 py-3 text-left transition ' +
                    (on
                      ? 'border-signal bg-signal/10 text-ink-100'
                      : 'border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600')
                  }
                >
                  <span className="block text-sm">{s.label}</span>
                  <span className="mt-0.5 block text-2xs text-ink-500">{s.eg}</span>
                </button>
              );
            })}
          </div>
        </Question>
      )}

      {step === 2 && (
        <Question
          title="How often, and how long does it take you?"
          help="Rough numbers are fine. This is what decides whether automating it is worth anyone's time."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Number label="Times per month" value={timesPerMonth} onChange={setTimes} min={1} max={100000} suffix="/mo" />
            <Number label="Minutes each time" value={minutesEach} onChange={setMinutes} min={1} max={480} suffix="min" />
          </div>
          <p className="mt-4 text-sm text-ink-400">
            That is roughly{' '}
            <span className="font-mono text-ink-100">
              {((timesPerMonth * minutesEach) / 60).toFixed(1)} hours
            </span>{' '}
            a month.
          </p>
        </Question>
      )}

      {step === 3 && (
        <Question title="What goes into it?" help="This decides what warnings you get, and whether you should be sending this anywhere at all.">
          <Toggle
            on={involvesPersonalData}
            set={setPersonal}
            label="It involves other people's personal details"
            help="Names, emails, addresses, anything about a specific identifiable person."
          />
          <Toggle
            on={involvesMoneyOrLegal}
            set={setMoney}
            label="It involves money, contracts or anything legal"
            help="Invoices, payments, agreements, tax, medical or financial advice."
          />
        </Question>
      )}

      {step === 4 && (
        <Question title="What does a good answer need?">
          <Toggle
            on={needsExactAnswer}
            set={setExact}
            label="There is exactly one correct answer"
            help="A number, a record, a fact that is either right or wrong — not a judgement call."
          />
          <Toggle
            on={needsCurrentInfo}
            set={setCurrent}
            label="It depends on current or private information"
            help="Today's prices, this week's news, your own documents — things a model cannot know on its own."
          />
        </Question>
      )}

      {step === 5 && (
        <Question
          title="If the answer were subtly wrong, would you notice?"
          help="This is the question most people get wrong about AI, and it matters more than cost."
        >
          <div className="space-y-2">
            {[
              { id: 'immediately', label: 'Yes, immediately', help: 'You read every word before it goes anywhere.' },
              { id: 'eventually', label: 'Eventually', help: 'It would surface in a day or two, probably.' },
              { id: 'never', label: 'Probably never', help: 'It goes straight out, or nobody checks.' },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setNotice(o.id as typeof wouldNoticeIfWrong)}
                className={
                  'w-full rounded-lg border px-4 py-3 text-left transition ' +
                  (wouldNoticeIfWrong === o.id
                    ? 'border-signal bg-signal/10 text-ink-100'
                    : 'border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600')
                }
              >
                <span className="block text-sm">{o.label}</span>
                <span className="mt-0.5 block text-2xs text-ink-500">{o.help}</span>
              </button>
            ))}
          </div>
        </Question>
      )}

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="text-sm text-ink-500 transition hover:text-ink-300 disabled:opacity-30"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!canAdvance}
          onClick={() => (step === STEPS - 1 ? submit() : setStep((s) => s + 1))}
          className="rounded-lg bg-signal px-5 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-signal-glow disabled:bg-ink-700 disabled:text-ink-500"
        >
          {step === STEPS - 1 ? 'Get the answer' : 'Next'}
        </button>
      </div>
    </div>
  );
}

function Question({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-xl font-semibold leading-snug text-ink-100">{title}</h1>
      {help && <p className="mt-2 text-sm leading-relaxed text-ink-400" dangerouslySetInnerHTML={{ __html: help }} />}
      <div className="mt-6">{children}</div>
    </div>
  );
}

function Number({
  label, value, onChange, min, max, suffix,
}: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; suffix: string }) {
  return (
    <label className="block">
      <span className="text-xs text-ink-400">{label}</span>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Math.max(min, Math.min(max, globalThis.Number(e.target.value) || min)))}
          className="w-full rounded-lg border border-ink-700 bg-ink-850 px-4 py-2.5 font-mono text-base text-ink-100 focus:border-signal focus:outline-none"
        />
        <span className="shrink-0 text-xs text-ink-500">{suffix}</span>
      </div>
    </label>
  );
}

function Toggle({
  on, set, label, help,
}: { on: boolean; set: (b: boolean) => void; label: string; help: string }) {
  return (
    <button
      type="button"
      onClick={() => set(!on)}
      className={
        'mb-2 flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition ' +
        (on ? 'border-signal bg-signal/10' : 'border-ink-700 bg-ink-850 hover:border-ink-600')
      }
    >
      <span
        className={
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-2xs ' +
          (on ? 'border-signal bg-signal text-ink-950' : 'border-ink-600')
        }
      >
        {on ? '✓' : ''}
      </span>
      <span>
        <span className={'block text-sm ' + (on ? 'text-ink-100' : 'text-ink-300')}>{label}</span>
        <span className="mt-0.5 block text-2xs leading-relaxed text-ink-500">{help}</span>
      </span>
    </button>
  );
}
