import { byId, costOfCall, estimateTokens } from '@ark/core';
import type { AdapterId, CompletionRequest, ProviderAdapter } from '@ark/providers';
import type { RuntimeConstraints } from './types.js';

const LATENCY_MS = { fast: 1500, standard: 4000, slow: 12_000 } as const;

/** Open-weight chat families Ollama actually runs. Not gpt-* / Claude / Bedrock ARNs. */
const OPEN_WEIGHT = [
  'deepseek',
  'llama',
  'mistral',
  'mixtral',
  'qwen',
  'phi',
  'gemma',
  'yi',
  'glm',
  'internlm',
  'falcon',
  'vicuna',
  'wizard',
  'dolphin',
  'hermes',
  'openchat',
  'solar',
  'olmo',
  'smol',
  'granite',
  'starcoder',
  'codellama',
  'command-r',
  'commandr',
  'aya',
  'nous',
  'orca',
  'zephyr',
  'tinyllama',
  'stablelm',
  'rwkv',
  'dbrx',
  'jamba',
  'nemotron',
  'llava',
  'minicpm',
  'baichuan',
];

export function isOpenWeightModel(model: string): boolean {
  const m = model.toLowerCase();
  return OPEN_WEIGHT.some((tag) => m.includes(tag));
}

export function localCatalogId(modelId: string): string {
  const m = modelId.toLowerCase();
  if (m.includes('70b') || m.includes('72b') || m.includes('405b') || m.includes('671b')) return 'local-70b';
  if (m.includes('14b') || m.includes('13b')) return 'local-14b';
  // 32B/34B is closer to the 14B row than to 8B. Still an under-price, not a 70B guess.
  if (m.includes('32b') || m.includes('33b') || m.includes('34b')) return 'local-14b';
  // Unmatched Ollama ids (7B, "llama3.2", smollm2:135m, …) inherit the 8B catalog row.
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
  // Hosted DeepSeek (open-weight) uses the Chat Completions protocol, not Ollama.
  if (m === 'deepseek-chat' || m === 'deepseek-reasoner') {
    return 'openai-compatible';
  }
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) {
    return 'openai-compatible';
  }
  if (isOpenWeightModel(model)) {
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
