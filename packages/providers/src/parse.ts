import { ProviderError, type NormalizedCompletion } from './types.js';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** Ollama POST /api/chat (stream: false). */
export function parseOllamaChat(body: unknown, latencyMs: number, fallbackModel: string): NormalizedCompletion {
  if (!body || typeof body !== 'object') {
    throw new ProviderError('parse', 'ollama: empty body', 'ollama');
  }
  const b = body as Record<string, unknown>;
  const message = b.message && typeof b.message === 'object' ? (b.message as Record<string, unknown>) : {};
  const text = str(message.content);
  const done = str(b.done_reason);
  return {
    text,
    modelId: str(b.model) || fallbackModel,
    adapterId: 'ollama',
    catalogProvider: 'local',
    inputTokens: num(b.prompt_eval_count),
    outputTokens: num(b.eval_count),
    latencyMs,
    finishReason: done === 'length' ? 'length' : 'stop',
  };
}

/** OpenAI-compatible POST /v1/chat/completions. */
export function parseOpenAIChat(body: unknown, latencyMs: number, fallbackModel: string): NormalizedCompletion {
  if (!body || typeof body !== 'object') {
    throw new ProviderError('parse', 'openai-compatible: empty body', 'openai-compatible');
  }
  const b = body as Record<string, unknown>;
  const choices = Array.isArray(b.choices) ? b.choices : [];
  const first = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>) : {};
  const message = first.message && typeof first.message === 'object' ? (first.message as Record<string, unknown>) : {};
  const usage = b.usage && typeof b.usage === 'object' ? (b.usage as Record<string, unknown>) : {};
  const finish = str(first.finish_reason);
  return {
    text: str(message.content),
    modelId: str(b.model) || fallbackModel,
    adapterId: 'openai-compatible',
    catalogProvider: 'openai',
    inputTokens: num(usage.prompt_tokens),
    outputTokens: num(usage.completion_tokens),
    latencyMs,
    finishReason: finish === 'length' ? 'length' : 'stop',
  };
}

/** Bedrock Converse JSON. */
export function parseBedrockConverse(body: unknown, latencyMs: number, fallbackModel: string): NormalizedCompletion {
  if (!body || typeof body !== 'object') {
    throw new ProviderError('parse', 'bedrock: empty body', 'bedrock');
  }
  const b = body as Record<string, unknown>;
  const output = b.output && typeof b.output === 'object' ? (b.output as Record<string, unknown>) : {};
  const message = output.message && typeof output.message === 'object' ? (output.message as Record<string, unknown>) : {};
  const content = Array.isArray(message.content) ? message.content : [];
  const texts = content
    .map((part) => (part && typeof part === 'object' ? str((part as Record<string, unknown>).text) : ''))
    .filter(Boolean);
  const usage = b.usage && typeof b.usage === 'object' ? (b.usage as Record<string, unknown>) : {};
  const stop = str(b.stopReason);
  return {
    text: texts.join(''),
    modelId: fallbackModel,
    adapterId: 'bedrock',
    catalogProvider: 'bedrock',
    inputTokens: num(usage.inputTokens),
    outputTokens: num(usage.outputTokens),
    latencyMs,
    finishReason: stop === 'max_tokens' ? 'length' : 'stop',
  };
}

export function toBedrockConverseBody(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  maxTokens?: number,
  temperature?: number,
): Record<string, unknown> {
  const system = messages.filter((m) => m.role === 'system').map((m) => ({ text: m.content }));
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ text: m.content }],
    }));
  if (rest.length === 0) {
    rest.push({
      role: 'user',
      content: [{ text: messages.map((m) => m.content).join('\n') }],
    });
  }
  const body: Record<string, unknown> = { messages: rest };
  if (system.length > 0) body.system = system;
  const inference: Record<string, unknown> = {};
  if (maxTokens) inference.maxTokens = maxTokens;
  if (temperature !== undefined) inference.temperature = temperature;
  if (Object.keys(inference).length > 0) body.inferenceConfig = inference;
  return body;
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}
