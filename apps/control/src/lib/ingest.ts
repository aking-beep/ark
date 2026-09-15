import { IngestBody, EventInput, TraceClose, detectSensitive, priceEvent } from '@ark/core';

export { IngestBody, EventInput, TraceClose, detectSensitive, priceEvent };

/** Providers this org has approved. Anything else is an exfiltration finding. */
export function allowlist(): string[] {
  return (process.env.ARK_PROVIDER_ALLOWLIST ?? 'anthropic,openai,google,local')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
