import { byId, costOfCall, estimateTokens } from '@ark/core';
import { isOpenAIChatModel, type AdapterId, type CompletionRequest, type ProviderAdapter } from '@ark/providers';
import type { RuntimeConstraints } from './types.js';

const LATENCY_MS = { fast: 1500, standard: 4000, slow: 12_000 } as const;

export function localCatalogId(modelId: string): string {
  const m = modelId.toLowerCase();
  if (m.includes('70b')) return 'local-70b';
  if (m.includes('14b')) return 'local-14b';
  // Unmatched Ollama ids (32B, 7B, "llama3.2", …) inherit the 8B catalog row.
  // That is a known under-price for a 32B, not a guess that it is 70B or 14B.
  return 'local-8b';
}

export function catalogModelId(adapter: ProviderAdapter, requested?: string): string {
  const raw = requested ?? adapter.defaultModel();
  if (byId(raw)) return raw;
  if (adapter.id === 'ollama') return localCatalogId(raw);
  return raw;
}

export function estimateCostUsd(adapter: ProviderAdapter, req: CompletionRequest): number | null {
  const model = byId(catalogModelId(adapter, req.model));
  if (!model) return null;
  const input = estimateTokens(req.messages.map((m) => m.content).join('\n')).value;
  const output = req.maxTokens ?? 256;
  return costOfCall(model, { inputTokens: input, outputTokens: output });
}

export function heuristicLatencyMs(adapter: ProviderAdapter): number {
  return LATENCY_MS[adapter.latencyClass];
}

export function hintAdapter(model: string | undefined): AdapterId | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  if (
    m.startsWith('amazon.') ||
    m.startsWith('anthropic.') ||
    m.startsWith('meta.') ||
    m.startsWith('mistral.') ||
    m.includes('nova')
  ) {
    return 'bedrock';
  }
  if (isOpenAIChatModel(model)) {
    return 'openai-compatible';
  }
  if (m.includes('llama') || m.includes('mistral') || m.includes('qwen') || m.includes('phi') || m.includes('gemma')) {
    return 'ollama';
  }
  return undefined;
}

export function completionFrom(req: {
  messages: CompletionRequest['messages'];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): CompletionRequest {
  return {
    messages: req.messages,
    model: req.model,
    maxTokens: req.maxTokens,
    temperature: req.temperature,
  };
}

export function costConstraintApplies(constraints: RuntimeConstraints, usd: number | null): boolean {
  if (constraints.maxCostUsd === undefined || usd === null) return false;
  return usd > constraints.maxCostUsd;
}

export function latencyConstraintApplies(constraints: RuntimeConstraints, heuristicMs: number): boolean {
  if (constraints.maxLatencyMs === undefined) return false;
  return heuristicMs > constraints.maxLatencyMs;
}
