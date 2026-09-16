import type { Capability } from '@ark/core';
import { fetchWithTimeout, readJson } from './http.js';
import { parseBedrockConverse, toBedrockConverseBody } from './parse.js';
import { signBedrockConverse } from './sigv4.js';
import {
  CompletionRequest,
  ProviderError,
  type FetchFn,
  type NormalizedCompletion,
  type ProviderAdapter,
} from './types.js';

export interface BedrockConfig {
  region?: string;
  modelId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  timeoutMs?: number;
  fetch?: FetchFn;
}

/**
 * Managed-cloud execution via Bedrock Runtime Converse. Credentials from env;
 * no AWS SDK.
 */
export class BedrockAdapter implements ProviderAdapter {
  readonly id = 'bedrock' as const;
  readonly catalogProvider = 'bedrock' as const;
  readonly residency = 'cloud' as const;
  readonly capabilities: Capability[] = ['text', 'structured_output', 'vision', 'tool_use'];
  readonly latencyClass = 'standard' as const;

  private readonly region: string;
  private readonly modelId: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly sessionToken?: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchFn;

  constructor(cfg: BedrockConfig = {}) {
    this.region = cfg.region ?? '';
    this.modelId = cfg.modelId ?? '';
    this.accessKeyId = cfg.accessKeyId ?? '';
    this.secretAccessKey = cfg.secretAccessKey ?? '';
    this.sessionToken = cfg.sessionToken;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.fetchFn = cfg.fetch ?? fetch;
  }

  configured(): boolean {
    return (
      this.region.length > 0 &&
      this.modelId.length > 0 &&
      this.accessKeyId.length > 0 &&
      this.secretAccessKey.length > 0
    );
  }

  defaultModel(): string {
    return this.modelId;
  }

  async complete(req: CompletionRequest): Promise<NormalizedCompletion> {
    const parsed = CompletionRequest.parse(req);
    if (!this.configured()) {
      throw new ProviderError(
        'config',
        'bedrock is not configured (ARK_BEDROCK_REGION, ARK_BEDROCK_MODEL_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)',
        'bedrock',
      );
    }
    const model = parsed.model ?? this.modelId;
    const body = JSON.stringify(
      toBedrockConverseBody(parsed.messages, parsed.maxTokens, parsed.temperature),
    );
    const signed = signBedrockConverse({
      region: this.region,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      modelId: model,
      body,
    });
    const started = Date.now();
    const res = await fetchWithTimeout(
      this.fetchFn,
      signed.url,
      { method: 'POST', headers: signed.headers, body },
      this.timeoutMs,
      'bedrock',
    );
    const json = await readJson(res, 'bedrock');
    return parseBedrockConverse(json, Date.now() - started, model);
  }
}
