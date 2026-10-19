/**
 * Canonical JSON for digests: object keys sorted, no whitespace, `undefined`
 * keys omitted. Internal to the governance kernel; not exported from `@ark/core`.
 *
 * Throws on a non-finite number rather than encoding it ambiguously
 * (`JSON.stringify(NaN)` is `null`). The kernel never passes one, and
 * `decideAction` turns any throw into a fail-closed decision.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('canonicalJson: non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as Json)}`).join(',')}}`;
}
