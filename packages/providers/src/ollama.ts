import type { Capability } from '@ark/core';
import { fetchWithTimeout, readJson } from './http.js';
import { parseOllamaChat } from './parse.js';
import {
  CompletionRequest,
  ProviderError,
  type FetchFn,
  type NormalizedCompletion,
  type ProviderAdapter,
} from './types.js';

export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: FetchFn;
  /** When true, skip GET /api/tags and POST the requested id (Ollama may pull). */
  allowPull?: boolean;
}

/** Ollama's Hub GGUF scheme is hf.co/org/repo, not huggingface.co/org/repo. */
export function ollamaNativeModel(id: string): string {
  const trimmed = id.replace(/^https?:\/\//i, '');
  if (/^huggingface\.co\//i.test(trimmed)) {
    return `hf.co/${trimmed.slice('huggingface.co/'.length)}`;
  }
  return id;
}

export function parseOllamaTags(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const names: string[] = [];
  for (const row of models) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { name?: unknown; model?: unknown };
    const name = typeof rec.name === 'string' ? rec.name : typeof rec.model === 'string' ? rec.model : '';
    if (name) names.push(name);
  }
  return names;
}

/**
 * Map a requested id onto an installed Ollama tag.
 * Exact, `:latest`, then a unique `name:` family prefix. Different families never substitute.
 */
export function resolveOllamaTag(requested: string, installed: string[]): string | null {
  const want = ollamaNativeModel(requested).trim();
  if (!want) return null;
  const names = installed.map((n) => ollamaNativeModel(n).trim()).filter(Boolean);
  const exact = names.find((n) => n === want);
  if (exact) return exact;
  const asLatest = names.find((n) => n === `${want}:latest`);
  if (asLatest) return asLatest;
  if (want.endsWith(':latest')) {
    const bare = want.slice(0, -':latest'.length);
    const found = names.find((n) => n === bare);
    if (found) return found;
  }
  const family = names.filter((n) => n === want || n.startsWith(`${want}:`));
  if (family.length === 1) return family[0]!;
  return null;
}

/**
 * Local execution. Talks to Ollama's HTTP API; nothing leaves the machine.
 * Lists installed tags before chat so a missing id cannot start a Hub pull.
 */
export class OllamaAdapter implements ProviderAdapter {
  readonly id = 'ollama' as const;
  readonly catalogProvider = 'local' as const;
  readonly residency = 'local' as const;
  readonly capabilities: Capability[] = ['text', 'structured_output'];
  readonly latencyClass = 'fast' as const;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchFn;
  private readonly enabled: boolean;
  private readonly allowPull: boolean;

  constructor(cfg: OllamaConfig = {}) {
    this.baseUrl = (cfg.baseUrl ?? '').replace(/\/+$/, '');
    this.model = cfg.model ?? 'llama3.2';
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.fetchFn = cfg.fetch ?? fetch;
    this.enabled = this.baseUrl.length > 0;
    this.allowPull = Boolean(cfg.allowPull);
  }

  configured(): boolean {
    return this.enabled;
  }

  defaultModel(): string {
    return this.model;
  }

  async complete(req: CompletionRequest): Promise<NormalizedCompletion> {
    const parsed = CompletionRequest.parse(req);
    if (!this.enabled) {
      throw new ProviderError('config', 'ollama is not configured (set ARK_OLLAMA_URL)', 'ollama');
    }
    const requested = ollamaNativeModel(parsed.model ?? this.model);
    const model = this.allowPull ? requested : await this.resolveInstalled(requested);
    const started = Date.now();
    const res = await fetchWithTimeout(
      this.fetchFn,
      `${this.baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: parsed.messages,
          stream: false,
          options: {
            ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
            ...(parsed.maxTokens !== undefined ? { num_predict: parsed.maxTokens } : {}),
          },
        }),
      },
      this.timeoutMs,
      'ollama',
    );
    const body = await readJson(res, 'ollama');
    return parseOllamaChat(body, Date.now() - started, model);
  }

  private async resolveInstalled(requested: string): Promise<string> {
    const res = await fetchWithTimeout(
      this.fetchFn,
      `${this.baseUrl}/api/tags`,
      { method: 'GET', headers: { accept: 'application/json' } },
      this.timeoutMs,
      'ollama',
    );
    const body = await readJson(res, 'ollama');
    const installed = parseOllamaTags(body);
    const resolved = resolveOllamaTag(requested, installed);
    if (resolved) return resolved;
    const have = installed.length ? installed.join(', ') : '(none)';
    throw new ProviderError(
      'config',
      `ollama model '${requested}' is not installed (have: ${have}). ollama pull ${requested}, or set ARK_OLLAMA_PULL=1`,
      'ollama',
    );
  }
}
