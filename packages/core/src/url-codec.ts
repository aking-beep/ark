import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Neither AIFit surface stores anything.
 *
 * A tool that asks what you do all day and then keeps a copy has to earn that.
 * These two do not keep anything: the answers live in the link, the assessment
 * is recomputed server-side on every view, and the consequence — a truncated
 * link cannot be recovered — is stated plainly on the page rather than hidden.
 *
 * Both surfaces need the identical three functions over different schemas, so
 * the codec is parameterised by the schema instead of being copied. A copy
 * would be harmless until the day one surface fixed a padding bug and the
 * other did not.
 *
 * Practical limit: a fully-specified Workload encodes to roughly 1.5–3 KB,
 * comfortably inside the ~8 KB request-line limit of every common proxy. If an
 * intake ever grows past that, this is the file that changes, not the model.
 */
export interface UrlCodec<T> {
  /** Server-side encode. */
  encode(value: T): string;
  /** Returns null on malformed base64, malformed JSON, or schema mismatch. */
  decode(encoded: string): T | null;
}

// The third type argument is the schema's *input* type, which differs from its
// output wherever `.default()` is used — which, in Workload, is nearly
// everywhere. Pinning it open is what lets this accept both schemas.
export function urlCodec<T>(schema: ZodType<T, ZodTypeDef, any>): UrlCodec<T> {
  return {
    encode(value) {
      return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    },
    decode(encoded) {
      try {
        const json = Buffer.from(encoded, 'base64url').toString('utf8');
        const parsed = schema.safeParse(JSON.parse(json));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Browser-safe encoder for the intake forms.
 *
 * Kept separate from `urlCodec` because it runs in a client component where
 * `Buffer` does not exist. It must produce byte-identical output to
 * `urlCodec().encode` — base64url, unpadded — or a link minted in the browser
 * will not decode on the server.
 */
export function encodeForUrlClient(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
