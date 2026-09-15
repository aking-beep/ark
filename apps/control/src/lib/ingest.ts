import { IngestBody, EventInput, TraceClose, detectSensitive, priceEvent } from '@ark/core';

export { IngestBody, EventInput, TraceClose, detectSensitive, priceEvent };

/** Providers this org has approved. Anything else is an exfiltration finding. */
export function allowlist(): string[] {
  return (process.env.ARK_PROVIDER_ALLOWLIST ?? 'anthropic,openai,google,local')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function authorize(req: Request): boolean {
  const expected = process.env.ARK_INGEST_TOKEN;
  if (!expected) return true; // local dev: open by default, documented in .env.example
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
