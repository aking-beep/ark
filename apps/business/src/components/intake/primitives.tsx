'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Action } from '@/lib/intake-state';
import type { OptionGroup } from './options';

/* ------------------------------------------------------------------ */
/* Form primitives. Local to this app: the shared package deliberately  */
/* carries no form controls, because the three surfaces disagree about  */
/* how much to ask and that disagreement should not leak into @ark/ui.  */
/*                                                                      */
/* Every text and number input has a real <label htmlFor>; every set of */
/* choices is a <fieldset> with a <legend>. Focus is the global          */
/* :focus-visible ring in globals.css — nothing here removes it.        */
/* ------------------------------------------------------------------ */

export const HEADING_ID = 'intake-step-heading';

export function Section({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {/* Focus lands here when the step changes, so a screen reader hears where it is. */}
      <h1 id={HEADING_ID} tabIndex={-1} className="text-2xl font-semibold leading-snug text-ink-100">
        {title}
      </h1>
      {help && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-400">{help}</p>}
      <div className="mt-7 space-y-6">{children}</div>
    </div>
  );
}

const LABEL = 'block text-xs font-medium text-ink-200';
const HINT = 'mt-1 max-w-2xl text-2xs leading-relaxed text-ink-400';

/** A labelled single control. `children` receives the id and describedby to wire up. */
export function Field({
  label, hint, optional, children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
        {optional && <span className="ml-2 font-normal text-ink-400">optional</span>}
      </label>
      {hint && <p id={hintId} className={HINT}>{hint}</p>}
      <div className="mt-2.5">{children({ id, describedBy: hint ? hintId : undefined })}</div>
    </div>
  );
}

/** A labelled set of controls. */
export function Group({
  label, hint, role, children,
}: { label: string; hint?: string; role?: 'radiogroup'; children: ReactNode }) {
  const hintId = useId();
  return (
    <fieldset role={role} aria-describedby={hint ? hintId : undefined} className="min-w-0">
      <legend className={LABEL}>{label}</legend>
      {hint && <p id={hintId} className={HINT}>{hint}</p>}
      <div className="mt-2.5">{children}</div>
    </fieldset>
  );
}

const INPUT =
  'w-full rounded-lg border border-ink-700 bg-ink-850 px-4 py-2.5 text-sm text-ink-100 placeholder:text-ink-400 focus:border-signal';

export function TextInput({
  id, describedBy, value, onChange, placeholder, autoFocus, mono,
}: {
  id: string; describedBy?: string; value: string; onChange: (s: string) => void;
  placeholder?: string; autoFocus?: boolean; mono?: boolean;
}) {
  return (
    <input
      id={id}
      aria-describedby={describedBy}
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={INPUT + (mono ? ' font-mono' : '')}
    />
  );
}

export function Area({
  id, describedBy, value, onChange, placeholder, rows = 3,
}: {
  id: string; describedBy?: string; value: string; onChange: (s: string) => void;
  placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      id={id}
      aria-describedby={describedBy}
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={INPUT + ' resize-none leading-relaxed'}
    />
  );
}

/**
 * A number that may be blank. Blank is a real state — "not answered" for the
 * required fields, "unknown" for the optional ones — so it is never coerced
 * to a minimum. Values are only kept within [0, max]; whether a value is
 * enough to advance is `blockedReason`'s call, not the input's.
 */
export function NumInput({
  id, describedBy, value, onChange, max, suffix, placeholder,
}: {
  id: string; describedBy?: string; value: number | ''; onChange: (n: number | '') => void;
  max: number; suffix?: string; placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        aria-describedby={describedBy}
        type="number"
        inputMode="decimal"
        value={value}
        min={0}
        max={max}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange('');
          const n = Number(raw);
          if (!Number.isFinite(n)) return onChange('');
          onChange(Math.max(0, Math.min(max, n)));
        }}
        className={INPUT + ' font-mono'}
      />
      {suffix && <span className="shrink-0 font-mono text-2xs text-ink-400">{suffix}</span>}
    </div>
  );
}

const CHOICE_ON = 'border-signal bg-signal/10 text-ink-100';
const CHOICE_OFF = 'border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600';

export function Chip({
  on, onClick, label, help,
}: { on: boolean; onClick: () => void; label: string; help?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={'min-h-10 w-full rounded-lg border px-3.5 py-2.5 text-left transition ' + (on ? CHOICE_ON : CHOICE_OFF)}
    >
      <span className="flex items-center gap-2 text-xs">
        <span
          aria-hidden
          className={
            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[0.6rem] ' +
            (on ? 'border-signal bg-signal text-ink-950' : 'border-ink-600')
          }
        >
          {on ? '✓' : ''}
        </span>
        {label}
      </span>
      {help && <span className="mt-0.5 block pl-5 text-2xs leading-relaxed text-ink-400">{help}</span>}
    </button>
  );
}

/**
 * A multi-select wall of chips, split into labelled sub-groups. A fork group
 * is drawn apart with its own note, because selecting only from it decides
 * the verdict.
 */
export function ChipGroups<T extends string>({
  label, hint, groups, selected, toggle, columns = 2,
}: {
  label: string;
  hint?: string;
  groups: OptionGroup<T>[];
  selected: readonly T[];
  toggle: (id: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <Group label={label} hint={hint}>
      <div className="space-y-4">
        {groups.map((g) => (
          <fieldset
            key={g.label}
            className={g.fork ? 'min-w-0 rounded-xl border border-dashed border-ink-600 p-3' : 'min-w-0'}
          >
            <legend
              className={
                'font-mono text-2xs uppercase tracking-widest ' + (g.fork ? 'px-1 text-ink-200' : 'text-ink-400')
              }
            >
              {g.label}
            </legend>
            {g.note && <p className="mt-1 text-2xs leading-relaxed text-ink-300">{g.note}</p>}
            <div className={'mt-2 grid gap-2 ' + (columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
              {g.options.map((o) => (
                <Chip
                  key={o.id}
                  on={selected.includes(o.id)}
                  onClick={() => toggle(o.id)}
                  label={o.label}
                  help={o.help}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Group>
  );
}

/**
 * A single choice: a fieldset holding a radio group. One stop in the tab
 * order (the checked option, or the first while none is), arrow keys move
 * and select, Home and End jump. It may start with nothing selected; the
 * caller decides whether that is allowed to stay that way.
 */
export function Choices<T extends string>({
  label, hint, value, onChange, options,
}: {
  label: string;
  hint?: string;
  value: T | '';
  onChange: (v: T) => void;
  options: { id: T; label: string; help?: string }[];
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex((o) => o.id === value);

  function move(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = options.length - 1;
    const next =
      e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(options[next]!.id);
    refs.current[next]?.focus();
  }

  return (
    // The fieldset is the radiogroup, so its legend is the group's name.
    <Group label={label} hint={hint} role="radiogroup">
      <div className="space-y-2">
        {options.map((o, i) => {
          const on = i === current;
          return (
            <button
              key={o.id}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (current === -1 && i === 0) ? 0 : -1}
              onClick={() => onChange(o.id)}
              onKeyDown={(e) => move(e, i)}
              className={'flex min-h-10 w-full items-start gap-3 rounded-lg border px-4 py-2.5 text-left transition ' + (on ? CHOICE_ON : CHOICE_OFF)}
            >
              <span
                aria-hidden
                className={
                  'mt-1 h-3.5 w-3.5 shrink-0 rounded-full border ' +
                  (on ? 'border-signal bg-signal shadow-[inset_0_0_0_2px_#12151c]' : 'border-ink-600')
                }
              />
              <span>
                <span className="block text-sm">{o.label}</span>
                {o.help && <span className="mt-0.5 block text-2xs leading-relaxed text-ink-400">{o.help}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </Group>
  );
}

export function Toggle({
  on, set, label, help,
}: { on: boolean; set: (b: boolean) => void; label: string; help?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => set(!on)}
      className={
        'flex min-h-10 w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition ' +
        (on ? 'border-signal bg-signal/10' : 'border-ink-700 bg-ink-850 hover:border-ink-600')
      }
    >
      <span
        aria-hidden
        className={
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-2xs ' +
          (on ? 'border-signal bg-signal text-ink-950' : 'border-ink-600')
        }
      >
        {on ? '✓' : ''}
      </span>
      <span>
        <span className={'block text-sm ' + (on ? 'text-ink-100' : 'text-ink-300')}>{label}</span>
        {help && <span className="mt-0.5 block text-2xs leading-relaxed text-ink-400">{help}</span>}
      </span>
    </button>
  );
}

const BLAST = ['none', 'reversible', 'costly', 'irreversible'] as const;

export function ActionEditor({
  actions, setActions,
}: { actions: Action[]; setActions: (a: Action[]) => void }) {
  const base = useId();
  function update(i: number, patch: Partial<Action>) {
    setActions(actions.map((a, n) => (n === i ? { ...a, ...patch } : a)));
  }

  return (
    <div className="space-y-3">
      {actions.map((a, i) => (
        <fieldset key={i} className="min-w-0 rounded-lg border border-ink-700 bg-ink-850 p-4">
          <legend className="sr-only">Action {i + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${base}-${i}-name`} className="block text-2xs text-ink-400">Action</label>
              <input
                id={`${base}-${i}-name`}
                value={a.name}
                placeholder="refund_order"
                onChange={(e) => update(i, { name: e.target.value })}
                className={INPUT + ' mt-1 font-mono text-xs'}
              />
            </div>
            <div>
              <label htmlFor={`${base}-${i}-system`} className="block text-2xs text-ink-400">In system</label>
              <input
                id={`${base}-${i}-system`}
                value={a.system}
                placeholder="Stripe"
                onChange={(e) => update(i, { system: e.target.value })}
                className={INPUT + ' mt-1 text-xs'}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={a.write}
              onClick={() => update(i, { write: !a.write })}
              className={
                'min-h-10 rounded-md border px-3 text-2xs transition ' +
                (a.write ? 'border-warn bg-warn/10 text-warn' : 'border-ink-600 text-ink-300')
              }
            >
              {a.write ? 'writes' : 'read only'}
            </button>
            <div role="radiogroup" aria-label="If it goes wrong" className="flex flex-wrap gap-2">
              {BLAST.map((b) => (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={a.blastRadius === b}
                  onClick={() => update(i, { blastRadius: b })}
                  className={
                    'min-h-10 rounded-md border px-3 text-2xs transition ' +
                    (a.blastRadius === b
                      ? b === 'irreversible'
                        ? 'border-danger bg-danger/10 text-danger'
                        : 'border-signal bg-signal/10 text-ink-100'
                      : 'border-ink-700 text-ink-400 hover:border-ink-600')
                  }
                >
                  {b}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setActions(actions.filter((_, n) => n !== i))}
              className="ml-auto min-h-10 px-2 text-2xs text-ink-400 transition hover:text-danger"
            >
              remove<span className="sr-only"> action {i + 1}</span>
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          setActions([...actions, { name: '', system: '', write: false, blastRadius: 'reversible' }])
        }
        className="min-h-10 rounded-lg border border-dashed border-ink-700 px-4 py-2.5 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-200"
      >
        + Add an action
      </button>
    </div>
  );
}
