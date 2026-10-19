import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/**
 * Synchronous SHA-256 over the UTF-8 bytes of a string, as lowercase hex.
 *
 * Backed by `@noble/hashes` (audited, pure JS, synchronous). Why not
 * `node:crypto`: `@ark/core` is imported by browser client components
 * (apps/business), and Next's client bundler rejects `node:` imports. Why not
 * WebCrypto: `subtle.digest` is async, and `decideAction` must stay synchronous.
 * Used for request digests and decision ids only.
 */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}
