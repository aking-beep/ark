import { Workload } from '@ark/core';

/**
 * The business app stores nothing either.
 *
 * A small team evaluating whether to hand a job to a model is describing, in
 * detail, how their business works. There is no reason for us to hold that.
 * The intake is encoded into the report link; the assessment is recomputed on
 * every view. The consequence — a truncated link cannot be recovered — is a
 * fair price, and it is stated plainly on the page.
 *
 * Practical limit: a fully-specified Workload encodes to roughly 1.5–3 KB,
 * comfortably inside the ~8 KB request-line limit of every common proxy. If a
 * future intake grows past that, this is the file that changes, not the model.
 */
export function encodeWorkload(w: Workload): string {
  return Buffer.from(JSON.stringify(w), 'utf8').toString('base64url');
}

export function decodeWorkload(encoded: string): Workload | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = Workload.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Browser-safe encoder for the client intake form. */
export function encodeWorkloadClient(w: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(w));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
