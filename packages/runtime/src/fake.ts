import type { AdapterId, CompletionRequest, NormalizedCompletion, ProviderAdapter } from '@ark/providers';

export function fakeAdapter(opts: {
  id: AdapterId;
  residency: 'local' | 'cloud';
  configured?: boolean;
  complete?: (req: CompletionRequest) => Promise<NormalizedCompletion>;
  capabilities?: ProviderAdapter['capabilities'];
  latencyClass?: ProviderAdapter['latencyClass'];
  model?: string;
}): ProviderAdapter {
  const catalogProvider = opts.id === 'ollama' ? 'local' : opts.id === 'bedrock' ? 'bedrock' : 'openai';
  const model = opts.model ?? (opts.id === 'ollama' ? 'llama3.2' : opts.id === 'bedrock' ? 'amazon.nova-lite-v1:0' : 'gpt-5-nano');
  return {
    id: opts.id,
    catalogProvider,
    residency: opts.residency,
    capabilities: opts.capabilities ?? ['text'],
    latencyClass: opts.latencyClass ?? (opts.id === 'ollama' ? 'fast' : 'standard'),
    configured: () => opts.configured !== false,
    defaultModel: () => model,
    complete:
      opts.complete ??
      (async () => ({
        text: `ok:${opts.id}`,
        modelId: model,
        adapterId: opts.id,
        catalogProvider,
        inputTokens: 8,
        outputTokens: 2,
        latencyMs: 5,
        finishReason: 'stop' as const,
      })),
  };
}

export const trio = {
  ollama: () => fakeAdapter({ id: 'ollama', residency: 'local' }),
  bedrock: () => fakeAdapter({ id: 'bedrock', residency: 'cloud' }),
  frontier: () => fakeAdapter({ id: 'openai-compatible', residency: 'cloud' }),
};
