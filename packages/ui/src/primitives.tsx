import * as React from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ layout */

export function Panel({
  title,
  subtitle,
  right,
  children,
  className,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'rounded-xl border border-ink-700 bg-ink-850 shadow-panel',
        className,
      )}
    >
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 border-b border-ink-700 px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0 text-xs text-ink-400">{right}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Grid({
  cols = 3,
  children,
  className,
}: {
  cols?: 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  const map = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  } as const;
  return <div className={cx('grid grid-cols-1 gap-4', map[cols], className)}>{children}</div>;
}

/* ------------------------------------------------------------------- stats */

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
  footer,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
  tone?: Tone;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 px-5 py-4 shadow-panel">
      <p className="text-2xs font-medium uppercase tracking-wider text-ink-400">{label}</p>
      <p className={cx('mt-1.5 font-mono text-2xl tabular-nums', TONE_TEXT[tone])}>
        {value}
        {unit && <span className="ml-1 text-sm text-ink-400">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-xs leading-relaxed text-ink-400">{hint}</p>}
      {footer && <div className="mt-2.5 border-t border-ink-700 pt-2.5">{footer}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ badges */

export type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info' | 'signal';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-100',
  good: 'text-good',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  signal: 'text-signal',
};

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-ink-600 bg-ink-800 text-ink-200',
  good: 'border-good/40 bg-good/10 text-good',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-info/40 bg-info/10 text-info',
  signal: 'border-signal/40 bg-signal/10 text-signal',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-2xs font-medium',
        TONE_CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The single most important component in the system.
 *
 * Every number rendered anywhere carries the basis it rests on, so a rubric
 * guess never gets to look like a measurement. If this tag is missing from a
 * figure, that figure is lying by omission.
 */
export function BasisTag({
  basis,
  source,
  sampleSize,
  className,
}: {
  basis: 'heuristic' | 'benchmark' | 'calibrated' | 'measured';
  source?: string;
  sampleSize?: number;
  className?: string;
}) {
  const tone: Tone =
    basis === 'measured' ? 'good' : basis === 'calibrated' ? 'signal' : basis === 'benchmark' ? 'info' : 'warn';
  const title = [
    BASIS_MEANING[basis],
    source ? `Source: ${source}` : null,
    sampleSize ? `n = ${sampleSize}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <Badge tone={tone} title={title} className={cx('font-mono lowercase', className)}>
      {basis}
      {sampleSize ? <span className="opacity-60">n={sampleSize}</span> : null}
    </Badge>
  );
}

const BASIS_MEANING: Record<string, string> = {
  heuristic: 'A rule of thumb. Nobody measured this. Treat it as a starting hypothesis.',
  benchmark: 'Published vendor or third-party figures, not your workload.',
  calibrated: 'Derived from measurements on systems like yours, not yours.',
  measured: 'Observed in your own running system.',
};

/* ------------------------------------------------------------------- bars */

export function Meter({
  pct,
  tone = 'signal',
  className,
  markerPct,
}: {
  pct: number;
  tone?: Tone;
  className?: string;
  markerPct?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const fill: Record<Tone, string> = {
    neutral: 'bg-ink-400',
    good: 'bg-good',
    warn: 'bg-warn',
    danger: 'bg-danger',
    info: 'bg-info',
    signal: 'bg-signal',
  };
  return (
    <div className={cx('relative h-2 w-full overflow-hidden rounded-full bg-ink-800', className)}>
      <div className={cx('h-full rounded-full transition-all', fill[tone])} style={{ width: `${clamped}%` }} />
      {markerPct != null && (
        <div
          className="absolute top-0 h-full w-px bg-ink-200/60"
          style={{ left: `${Math.max(0, Math.min(100, markerPct))}%` }}
        />
      )}
    </div>
  );
}

export function Sparkline({
  points,
  className,
  height = 44,
}: {
  points: number[];
  className?: string;
  height?: number;
}) {
  if (points.length < 2) return <div className={cx('h-11', className)} />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const w = 100;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = height - ((p - min) / span) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const area = `${d} L${w},${height} L0,${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cx('w-full', className)}
      style={{ height }}
      role="img"
      aria-label="trend"
    >
      <path d={area} fill="currentColor" className="text-signal/10" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="text-signal" />
    </svg>
  );
}

/* -------------------------------------------------------------- dimensions */

export interface DimensionRow {
  key: string;
  label: string;
  /** 0..100 */
  score: number;
  weight: number;
  reasoning?: string;
}

/**
 * The seven suitability dimensions, rendered identically on MY AI for teams and Control.
 *
 * The thresholds below are the only reason this component exists. They were
 * previously inlined in the consumer result page and the business report page,
 * which meant the two surfaces could drift into colouring the same score
 * differently — a rendering bug that would read to a user as the engine
 * disagreeing with itself. One engine, two surfaces, one threshold.
 */
export const DIMENSION_DANGER_BELOW = 40;
export const DIMENSION_WARN_BELOW = 65;

export function dimensionTone(score: number): Tone {
  if (score < DIMENSION_DANGER_BELOW) return 'danger';
  if (score < DIMENSION_WARN_BELOW) return 'warn';
  return 'good';
}

export function DimensionList({
  dimensions,
  showWeight = false,
  spacing = 'roomy',
}: {
  dimensions: DimensionRow[];
  showWeight?: boolean;
  spacing?: 'tight' | 'roomy';
}) {
  return (
    <ul className={spacing === 'tight' ? 'space-y-3' : 'space-y-4'}>
      {dimensions.map((d) => (
        <li key={d.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-ink-200">
              {d.label}
              {showWeight && (
                <span className="ml-2 font-mono text-2xs text-ink-600">
                  weight {d.weight.toFixed(2)}
                </span>
              )}
            </span>
            <span className="font-mono text-xs text-ink-400">{Math.round(d.score)}</span>
          </div>
          <Meter pct={d.score} tone={dimensionTone(d.score)} className="mt-1.5" />
          {d.reasoning && (
            <p className="mt-1.5 max-w-3xl text-2xs leading-relaxed text-ink-500">{d.reasoning}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ tables */

export function Table({
  head,
  children,
  className,
}: {
  head: React.ReactNode[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('-mx-5 overflow-x-auto px-5', className)}>
      <table className="w-full min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-700">
            {head.map((h, i) => (
              <th
                key={i}
                className={cx(
                  'whitespace-nowrap pb-2 text-2xs font-medium uppercase tracking-wider text-ink-400',
                  i === 0 ? 'text-left' : 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  align = 'right',
  className,
  mono,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
  mono?: boolean;
}) {
  return (
    <td
      className={cx(
        'py-2.5 align-top text-ink-200',
        align === 'left' ? 'text-left' : 'text-right',
        mono && 'font-mono tabular-nums',
        className,
      )}
    >
      {children}
    </td>
  );
}

/* ---------------------------------------------------------------- callouts */

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  const border: Record<Tone, string> = {
    neutral: 'border-l-ink-500',
    good: 'border-l-good',
    warn: 'border-l-warn',
    danger: 'border-l-danger',
    info: 'border-l-info',
    signal: 'border-l-signal',
  };
  return (
    <div className={cx('rounded-r-lg border-l-2 bg-ink-800/60 px-4 py-3', border[tone])}>
      {title && <p className={cx('text-xs font-semibold', TONE_TEXT[tone])}>{title}</p>}
      <div className="mt-1 text-sm leading-relaxed text-ink-300">{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- buttons */

export function Button({
  children,
  variant = 'primary',
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'quiet' }) {
  const styles = {
    primary: 'bg-signal text-ink-950 hover:bg-signal-glow disabled:bg-ink-700 disabled:text-ink-400',
    ghost: 'border border-ink-600 text-ink-100 hover:border-ink-500 hover:bg-ink-800',
    quiet: 'text-ink-300 hover:text-ink-100',
  }[variant];
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed',
        styles,
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ format */

export const fmt = {
  usd(v: number, digits?: number): string {
    const d = digits ?? (Math.abs(v) < 1 ? 4 : Math.abs(v) < 100 ? 2 : 0);
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  },
  pct(v: number, digits = 0): string {
    return `${v.toFixed(digits)}%`;
  },
  int(v: number): string {
    return Math.round(v).toLocaleString('en-US');
  },
  compactUsd(v: number): string {
    if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
    return fmt.usd(v, 2);
  },
  when(ts: number): string {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  },
};
