import { ConsumerIntake } from '@ark/core';

/**
 * Results are encoded into the URL rather than stored.
 *
 * A consumer tool that asks what you do all day and then keeps a copy has to
 * earn that. This one does not keep anything: the answers live in the link,
 * the assessment is recomputed server-side on every view, and the database
 * this app talks to is nobody's.
 */
export function encodeIntake(intake: ConsumerIntake): string {
  const json = JSON.stringify(intake);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeIntake(encoded: string): ConsumerIntake | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = ConsumerIntake.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Browser-safe encoder for the client wizard. */
export function encodeIntakeClient(intake: unknown): string {
  const json = JSON.stringify(intake);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
