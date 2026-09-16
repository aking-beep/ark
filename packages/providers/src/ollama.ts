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
}

/** Ollama's Hub GGUF scheme is hf.co/org/repo, not huggingface.co/org/repo. */
export function ollamaNativeModel(id: string): string {
  const trimmed = id.replace(/^https?:\/\//i, '');
  if (/^huggingface\.co\//i.test(trimmed)) {
    return `hf.co/${trimmed.slice('huggingface.co/'.length)}`;
  }
  return id;
}

/**
 * Local execution. Talks to Ollama's HTTP API; nothing leaves the machine.
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

  constructor(cfg: OllamaConfig = {}) {
    this.baseUrl = (cfg.baseUrl ?? '').replace(/\/+$/, '');
    this.model = cfg.model ?? 'llama3.2';
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.fetchFn = cfg.fetch ?? fetch;
    this.enabled = this.baseUrl.length > 0;
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
    const model = ollamaNativeModel(parsed.model ?? this.model);
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
}
