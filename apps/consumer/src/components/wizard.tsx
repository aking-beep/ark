'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { encodeIntakeClient } from '@/lib/encode';
import { useReadingLevel } from '@/components/reading-level';

/**
 * Six questions in plain language. Each one maps onto a field the business
 * engine already understands, so this is a genuinely narrower intake rather
 * than a separate, weaker product.
 *
 * Volume and hourly rate are deliberately not asked. Any cost figure built
 * from those would be fabricated; the report suppresses the section instead.
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
  const { detailed } = useReadingLevel();
  const [step, setStep] = useState(0);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [task, setTask] = useState<string[]>([]);
  const [needsExactAnswer, setExact] = useState(false);
  const [harmIfWrong, setHarm] = useState<'nothing' | 'redo' | 'serious'>('redo');
  const [needsCurrentInfo, setCurrent] = useState(false);
  const [doesSomething, setDoes] = useState(false);

  const canAdvance = useMemo(() => {
    if (step === 0) return name.trim().length > 1;
    if (step === 1) return task.length > 0;
    return true;
  }, [step, name, task]);

  function submit() {
    const encoded = encodeIntakeClient({
      id: `c_${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim(),
      task,
      needsExactAnswer,
      harmIfWrong,
      needsCurrentInfo,
      doesSomething,
    });
    router.push(`/result?i=${encoded}`);
  }

  const choiceOn = 'border-primary bg-primary/10 text-foreground';
  const choiceOff = 'border-border bg-card text-muted-foreground hover:bg-muted/50';

  return (
    <div>
      <div className="mb-8 flex items-center gap-2" role="status" aria-label={`Question ${step + 1} of ${STEPS}`}>
        {Array.from({ length: STEPS }).map((_, i) => (
          <div
            key={i}
            className={'h-1 flex-1 rounded-full transition ' + (i <= step ? 'bg-primary' : 'bg-border')}
          />
        ))}
      </div>

      {step === 0 && (
        <Question
          title="What is the task, in a sentence?"
          help={
            detailed
              ? 'One specific thing you do repeatedly. Not “marketing” — something like “write the weekly update email to clients”.'
              : 'One specific thing you do repeatedly.'
          }
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Write the weekly client update email"
            className="w-full rounded-xl border border-input bg-card px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional: a sentence about how you do it today."
            rows={3}
            className="mt-3 w-full resize-none rounded-xl border border-input bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
          />
        </Question>
      )}

      {step === 1 && (
        <Question
          title="What kind of work is it?"
          help={
            detailed
              ? 'Pick everything that applies. Maths and looking-up-a-known-answer are what trigger a no.'
              : 'Pick everything that applies.'
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {SHAPES.map((s) => {
              const on = task.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setTask(on ? task.filter((t) => t !== s.id) : [...task, s.id])}
                  className={'rounded-xl border px-4 py-3 text-left transition ' + (on ? choiceOn : choiceOff)}
                >
                  <span className="block text-sm">{s.label}</span>
                  {detailed && <span className="mt-0.5 block text-2xs text-muted-foreground">{s.eg}</span>}
                </button>
              );
            })}
          </div>
        </Question>
      )}

      {step === 2 && (
        <Question
          title="Does it need to be exactly right, or approximately right?"
          help={
            detailed
              ? 'Exactly right means there is one correct answer you could look up or calculate. Approximately right means a band of answers would be fine.'
              : 'Is there one correct answer, or would a few versions do?'
          }
        >
          <div className="space-y-2">
            {[
              { on: true, label: 'Exactly right', help: 'A number, a record, a fact — either correct or it is not.' },
              { on: false, label: 'Approximately right', help: 'Tone, a summary, a first draft. Several answers would do.' },
            ].map((o) => (
              <button
                key={String(o.on)}
                type="button"
                onClick={() => setExact(o.on)}
                className={'w-full rounded-xl border px-4 py-3 text-left transition ' + (needsExactAnswer === o.on ? choiceOn : choiceOff)}
              >
                <span className="block text-sm">{o.label}</span>
                {detailed && <span className="mt-0.5 block text-2xs text-muted-foreground">{o.help}</span>}
              </button>
            ))}
          </div>
        </Question>
      )}

      {step === 3 && (
        <Question
          title="What happens if it is wrong?"
          help={
            detailed
              ? 'This is the question most people get wrong about AI, and it matters more than volume.'
              : 'How bad is a miss?'
          }
        >
          <div className="space-y-2">
            {[
              { id: 'nothing' as const, label: 'Almost nothing', help: 'A draft nobody sends without reading. Cheap to redo.' },
              { id: 'redo' as const, label: 'Someone has to fix it', help: 'Caught downstream, annoying, not dangerous.' },
              { id: 'serious' as const, label: 'Money, safety, or legal consequences', help: 'A wrong answer becomes an incident.' },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setHarm(o.id)}
                className={'w-full rounded-xl border px-4 py-3 text-left transition ' + (harmIfWrong === o.id ? choiceOn : choiceOff)}
              >
                <span className="block text-sm">{o.label}</span>
                {detailed && <span className="mt-0.5 block text-2xs text-muted-foreground">{o.help}</span>}
              </button>
            ))}
          </div>
        </Question>
      )}

      {step === 4 && (
        <Question
          title="Does it need information from somewhere else, or just what you give it?"
          help={
            detailed
              ? 'Somewhere else means today’s prices, your documents, a database — things a model cannot know on its own.'
              : 'Is everything in what you paste in?'
          }
        >
          <div className="space-y-2">
            {[
              { on: false, label: 'Just what I give it', help: 'The whole job is in the text you paste in.' },
              { on: true, label: 'It needs information from somewhere else', help: 'Files, a system of record, the current state of the world.' },
            ].map((o) => (
              <button
                key={String(o.on)}
                type="button"
                onClick={() => setCurrent(o.on)}
                className={'w-full rounded-xl border px-4 py-3 text-left transition ' + (needsCurrentInfo === o.on ? choiceOn : choiceOff)}
              >
                <span className="block text-sm">{o.label}</span>
                {detailed && <span className="mt-0.5 block text-2xs text-muted-foreground">{o.help}</span>}
              </button>
            ))}
          </div>
        </Question>
      )}

      {step === 5 && (
        <Question
          title="Does it just produce an answer, or does it do something?"
          help={
            detailed
              ? 'Doing something means it changes a record, sends a message, moves money, files a ticket. This is the question that decides whether an agent is even on the table.'
              : 'Does it only write, or does it take an action?'
          }
        >
          <div className="space-y-2">
            {[
              { on: false, label: 'It just produces an answer', help: 'Text, a label, a summary. A person decides what happens next.' },
              { on: true, label: 'It does something', help: 'It takes an action in another system, not just writes words.' },
            ].map((o) => (
              <button
                key={String(o.on)}
                type="button"
                onClick={() => setDoes(o.on)}
                className={'w-full rounded-xl border px-4 py-3 text-left transition ' + (doesSomething === o.on ? choiceOn : choiceOff)}
              >
                <span className="block text-sm">{o.label}</span>
                {detailed && <span className="mt-0.5 block text-2xs text-muted-foreground">{o.help}</span>}
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
          className="text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-30"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!canAdvance}
          onClick={() => (step === STEPS - 1 ? submit() : setStep((s) => s + 1))}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground"
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
      <h1 className="text-xl font-semibold leading-snug tracking-tight text-foreground">{title}</h1>
      {help && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{help}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}
