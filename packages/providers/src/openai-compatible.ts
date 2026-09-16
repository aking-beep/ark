import type { Capability } from '@ark/core';
import { fetchWithTimeout, readJson } from './http.js';
import { chatCompletionsUrl, parseOpenAIChat } from './parse.js';
import {
  CompletionRequest,
  ProviderError,
  type FetchFn,
  type NormalizedCompletion,
  type ProviderAdapter,
} from './types.js';

export interface OpenAICompatibleConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: FetchFn;
}

/**
 * Frontier adapter. Any OpenAI-compatible chat-completions endpoint:
 * OpenAI, Groq, Together, Azure-compatible gateways, a local vLLM server.
 * Runtime does not import a vendor SDK.
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id = 'openai-compatible' as const;
  readonly catalogProvider = 'openai' as const;
  readonly residency = 'cloud' as const;
  readonly capabilities: Capability[] = [
    'text',
    'structured_output',
    'tool_use',
    'vision',
    'reasoning',
  ];
  readonly latencyClass = 'standard' as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchFn;

  constructor(cfg: OpenAICompatibleConfig = {}) {
    this.baseUrl = (cfg.baseUrl ?? '').replace(/\/+$/, '');
    this.apiKey = cfg.apiKey ?? '';
    this.model = cfg.model ?? '';
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.fetchFn = cfg.fetch ?? fetch;
  }

  configured(): boolean {
    return this.baseUrl.length > 0 && this.apiKey.length > 0 && this.model.length > 0;
  }

  defaultModel(): string {
    return this.model;
  }

  async complete(req: CompletionRequest): Promise<NormalizedCompletion> {
    const parsed = CompletionRequest.parse(req);
    if (!this.configured()) {
      throw new ProviderError(
        'config',
        'openai-compatible is not configured (ARK_FRONTIER_BASE_URL, ARK_FRONTIER_API_KEY, ARK_FRONTIER_MODEL)',
        'openai-compatible',
      );
    }
    const model = parsed.model ?? this.model;
    const started = Date.now();
    const payload: Record<string, unknown> = {
      model,
      messages: parsed.messages,
    };
    if (parsed.maxTokens !== undefined) payload.max_tokens = parsed.maxTokens;
    if (parsed.temperature !== undefined) payload.temperature = parsed.temperature;

    const res = await fetchWithTimeout(
      this.fetchFn,
      chatCompletionsUrl(this.baseUrl),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      this.timeoutMs,
      'openai-compatible',
    );
    const body = await readJson(res, 'openai-compatible');
    return parseOpenAIChat(body, Date.now() - started, model);
  }
}
