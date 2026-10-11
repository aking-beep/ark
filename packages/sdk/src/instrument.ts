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
  /**
   * Register a recording still in flight — a streamed response whose usage
   * arrives with the last chunk. The sink waits for these (bounded) before it
   * flushes, so a stream read inside `run()` still lands on the trace.
   */
  track?(pending: Promise<unknown>): void;
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

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** True for a `text/event-stream` content type, whatever its parameters. */
export function isEventStream(contentType: string | null | undefined): boolean {
  return !!contentType && contentType.toLowerCase().split(';')[0]!.trim() === 'text/event-stream';
}

/**
 * Collapse a server-sent-event body into the one JSON object a non-streamed
 * response would have been: `{ model, usage }`, nothing else.
 *
 * OpenAI (`stream_options.include_usage`) sends usage on the final chunk and
 * `usage: null` before it. Anthropic sends input and cache counts on
 * `message_start` (`message.usage`) and the running output count on each
 * `message_delta` (`usage`). Merging every usage object in order, later over
 * earlier, gives the right totals for both. Returns null when no chunk carried
 * usage — the stream is then skipped, not guessed at.
 */
export function usageFromEventStream(body: string): string | null {
  let usage: Record<string, unknown> | undefined;
  let model: string | undefined;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    const chunk = json(data);
    if (!chunk) continue;
    const message = obj(chunk.message);
    model = str(chunk.model) ?? str(message?.model) ?? model;
    for (const u of [obj(message?.usage), obj(chunk.usage)]) {
      if (u) usage = { ...usage, ...u };
    }
  }
  return usage ? JSON.stringify({ model, usage }) : null;
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
  /** The response content type. `text/event-stream` bodies are parsed as SSE. */
  contentType?: string | null;
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

  const responseBody = isEventStream(args.contentType) ? usageFromEventStream(args.responseBody) : args.responseBody;
  if (responseBody == null) return null;
  const res = json(responseBody);
  const req = json(args.requestBody);
  if (!res) return null;

  const usage = obj(res.usage);
  const completion = num(usage?.completion_tokens) ?? num(usage?.output_tokens);

  // The two providers count input differently, and the event contract is
  // that `inputTokens` is billed at the full rate and `cachedInputTokens` at
  // the cache-read rate, with no overlap (see `priceEvent`).
  //
  // OpenAI: `prompt_tokens` INCLUDES the cache reads reported in
  // `prompt_tokens_details.cached_tokens`, so they are subtracted.
  //
  // Anthropic: `input_tokens` EXCLUDES both cache reads
  // (`cache_read_input_tokens`) and cache writes
  // (`cache_creation_input_tokens`). Writes are billed, so they are added to
  // input; the catalog has no separate cache-write rate, so they are priced
  // at the input rate (a slight under-count against the provider's premium).
  let prompt: number | undefined;
  let cached: number | undefined;
  const openAiPrompt = num(usage?.prompt_tokens);
  if (openAiPrompt != null) {
    cached = num(obj(usage?.prompt_tokens_details)?.cached_tokens);
    prompt = Math.max(0, openAiPrompt - (cached ?? 0));
  } else {
    const input = num(usage?.input_tokens);
    const openAiStyleCached = num(obj(usage?.input_tokens_details)?.cached_tokens);
    if (openAiStyleCached != null && input != null) {
      // OpenAI Responses-style usage: input_tokens includes cached reads.
      cached = openAiStyleCached;
      prompt = Math.max(0, input - openAiStyleCached);
    } else {
      cached = num(usage?.cache_read_input_tokens);
      const writes = num(usage?.cache_creation_input_tokens);
      prompt = input != null || writes != null ? (input ?? 0) + (writes ?? 0) : undefined;
    }
  }
  if (prompt == null && completion == null) return null;

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
