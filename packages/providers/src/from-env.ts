import { BedrockAdapter, type BedrockConfig } from './bedrock.js';
import { OllamaAdapter, type OllamaConfig } from './ollama.js';
import { OpenAICompatibleAdapter, type OpenAICompatibleConfig } from './openai-compatible.js';
import type { FetchFn, ProviderAdapter } from './types.js';

export interface AdaptersFromEnv {
  env?: NodeJS.Dict<string>;
  fetch?: FetchFn;
  timeoutMs?: number;
}

/** Construct the three v0.1 adapters from process env. Unconfigured adapters stay in the list and report configured() === false. */
export function adaptersFromEnv(opts: AdaptersFromEnv = {}): ProviderAdapter[] {
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetch;
  const timeoutMs = opts.timeoutMs;
  const ollama: OllamaConfig = {
    baseUrl: env.ARK_OLLAMA_URL,
    model: env.ARK_OLLAMA_MODEL,
    timeoutMs,
    fetch: fetchFn,
  };
  const bedrock: BedrockConfig = {
    region: env.ARK_BEDROCK_REGION ?? env.AWS_REGION,
    modelId: env.ARK_BEDROCK_MODEL_ID,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
    timeoutMs,
    fetch: fetchFn,
  };
  const frontier: OpenAICompatibleConfig = {
    baseUrl: env.ARK_FRONTIER_BASE_URL,
    apiKey: env.ARK_FRONTIER_API_KEY,
    model: env.ARK_FRONTIER_MODEL,
    timeoutMs,
    fetch: fetchFn,
  };
  return [new OllamaAdapter(ollama), new BedrockAdapter(bedrock), new OpenAICompatibleAdapter(frontier)];
}
