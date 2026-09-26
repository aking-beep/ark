import { AsyncLocalStorage } from 'node:async_hooks';

/** Anything that can take a model event. `TraceHandle` is the one we use. */
export interface TraceSink {
  event(draft: {
    provider: string;
    modelId: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    latencyMs?: number;
    status?: 'ok' | 'error';
  }): unknown;
}

/**
 * The trace the current async chain is recording into.
 *
 * `instrumentFetch` reads this. Outside `run()` it is empty, which is how a
 * wrapped client used for a health check does not invent a unit of work.
 */
export const activeTrace = new AsyncLocalStorage<TraceSink>();

export function isControlIngestUrl(url: string): boolean {
  try {
    const u = new URL(url, 'http://local.invalid');
    return /\/api\/v1\/events\/?$/.test(u.pathname);
  } catch {
    return /\/api\/v1\/events/.test(url);
  }
}

function json(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Pull a model event out of one OpenAI- or Anthropic-shaped HTTP round trip.
 *
 * Fail open: a body we do not recognise is `null`, never a throw. The user's
 * call already succeeded; inventing a parse error here would make ARK the
 * outage.
 *
 * Never reads `messages`, `content`, `input`, or `output`. Those are payloads.
 */
export function observeLlmCall(args: {
  url: string;
  requestBody?: string;
  responseBody: string;
  latencyMs: number;
  status?: number;
}): {
  provider: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  latencyMs?: number;
  status?: 'ok' | 'error';
} | null {
  if (isControlIngestUrl(args.url)) return null;

  let path = args.url.toLowerCase();
  try {
    path = new URL(args.url, 'http://local.invalid').pathname.toLowerCase();
  } catch {
    /* keep the raw string */
  }
  const chat = path.includes('/chat/completions');
  const messages = /\/v1\/messages\/?$/.test(path);
  if (!chat && !messages) return null;

  const res = json(args.responseBody);
  const req = json(args.requestBody);
  if (!res) return null;

  const usage = (res.usage && typeof res.usage === 'object' ? res.usage : null) as Record<string, unknown> | null;
  const prompt = num(usage?.prompt_tokens) ?? num(usage?.input_tokens);
  const completion = num(usage?.completion_tokens) ?? num(usage?.output_tokens);
  if (prompt == null && completion == null) return null;

  const cached =
    num((usage?.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens)
    ?? num(usage?.cache_read_input_tokens);

  const modelId = str(req?.model) ?? str(res.model);
  if (!modelId) return null;

  const anthropic = messages && !chat;
  const ok = args.status == null || (args.status >= 200 && args.status < 300);

  return {
    provider: anthropic ? 'anthropic' : 'openai',
    modelId,
    inputTokens: prompt,
    outputTokens: completion,
    cachedInputTokens: cached,
    latencyMs: args.latencyMs >= 0 ? args.latencyMs : undefined,
    status: ok ? 'ok' : 'error',
  };
}

export function hrefOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
