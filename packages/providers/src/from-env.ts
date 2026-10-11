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
    allowPull: ['1', 'true', 'yes'].includes((env.ARK_OLLAMA_PULL ?? '').trim().toLowerCase()),
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
  const frontier: OpenAICompatibleConfig = { ...frontierFromEnv(env), timeoutMs, fetch: fetchFn };
  return [new OllamaAdapter(ollama), new BedrockAdapter(bedrock), new OpenAICompatibleAdapter(frontier)];
}

const DEEPSEEK_HOST = 'api.deepseek.com';
const HF_ROUTER_HOST = 'router.huggingface.co';

function httpsHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Frontier credentials are bound to the host they were issued for.
 * DEEPSEEK_API_KEY is only ever sent to api.deepseek.com and HF_TOKEN only to
 * router.huggingface.co. Any other ARK_FRONTIER_BASE_URL needs its own
 * ARK_FRONTIER_API_KEY, so a custom gateway never receives a vendor key that
 * happens to be in the environment.
 */
export function frontierFromEnv(env: NodeJS.Dict<string>): Pick<OpenAICompatibleConfig, 'baseUrl' | 'apiKey' | 'model'> {
  const frontierKey = env.ARK_FRONTIER_API_KEY?.trim() || '';
  const deepseekKey = env.DEEPSEEK_API_KEY?.trim() || '';
  const hfToken = (env.HF_TOKEN || env.HUGGING_FACE_HUB_TOKEN || '').trim();
  const customBase = env.ARK_FRONTIER_BASE_URL?.trim() || '';
  const explicitModel = env.ARK_FRONTIER_MODEL?.trim() || '';

  if (customBase) {
    const host = httpsHost(customBase);
    const isDeepSeek = host === DEEPSEEK_HOST;
    const isHf = host === HF_ROUTER_HOST;
    const apiKey = frontierKey || (isDeepSeek ? deepseekKey : '') || (isHf ? hfToken : '');
    const model = explicitModel || (isDeepSeek ? 'deepseek-chat' : '') || (isHf ? 'Qwen/Qwen3-8B' : '');
    return { baseUrl: customBase, apiKey, model };
  }
  // A frontier key without a base URL stays unconfigured: there is no default vendor.
  if (frontierKey) return { baseUrl: '', apiKey: frontierKey, model: explicitModel };
  if (deepseekKey) {
    return { baseUrl: `https://${DEEPSEEK_HOST}`, apiKey: deepseekKey, model: explicitModel || 'deepseek-chat' };
  }
  if (hfToken) {
    return { baseUrl: `https://${HF_ROUTER_HOST}`, apiKey: hfToken, model: explicitModel || 'Qwen/Qwen3-8B' };
  }
  return { baseUrl: '', apiKey: '', model: explicitModel };
}
