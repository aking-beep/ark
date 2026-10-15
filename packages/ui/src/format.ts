/** Number formatting shared by every surface. Pure, so it is unit-tested. */
export const fmt = {
  usd(v: number, digits?: number): string {
    const d = digits ?? (Math.abs(v) < 1 ? 4 : Math.abs(v) < 100 ? 2 : 0);
    // A real, non-zero cost must never print as $0.0000 beside a monthly bill:
    // below what `d` digits can show, give two significant figures instead.
    if (v !== 0 && Math.abs(v) < 0.5 * 10 ** -d) {
      return `$${v.toLocaleString('en-US', { maximumSignificantDigits: 2 })}`;
    }
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
    // Clamped at zero. Clock skew between a caller and Control is normal, and
    // a timestamp a minute ahead should read "0m ago", not "-1m ago".
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  },
};