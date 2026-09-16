/**
 * Runtime smoke. Always exercises policy/router with in-memory adapters.
 * When provider env is set, attempts a real one-token completion.
 *
 *   npm run smoke --workspace @ark/runtime
 *
 * Does not print prompts.
 */
import { adaptersFromEnv } from '@ark/providers';
import { createRuntime, execute, route, PolicyError } from './index.js';
import { fakeAdapter } from './fake.js';

const user = { role: 'user' as const, content: 'Reply with the single word pong.' };

function line(label: string, value: unknown): void {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

async function dryRun(): Promise<void> {
  console.log('--- dry-run (in-memory adapters) ---');
  const adapters = [
    fakeAdapter({ id: 'ollama', residency: 'local' }),
    fakeAdapter({ id: 'bedrock', residency: 'cloud' }),
    fakeAdapter({ id: 'openai-compatible', residency: 'cloud' }),
  ];
  const any = route({
    adapters,
    constraints: { privacy: 'any' },
    request: { messages: [user] },
    maxFallbacks: 1,
  });
  line('privacy=any selected', any.selected);
  line('privacy=any rationale', any.rationale);
  line('privacy=any fallbacks', any.fallbacks);

  const local = route({
    adapters,
    constraints: { privacy: 'local-only' },
    request: { messages: [user] },
    maxFallbacks: 3,
  });
  line('privacy=local-only selected', local.selected);
  line('privacy=local-only fallbacks', local.fallbacks);
  if (local.fallbacks.some((id) => id !== 'ollama')) {
    throw new Error('smoke: local-only listed a cloud fallback');
  }

  const refused = route({
    adapters: adapters.filter((a) => a.id !== 'ollama'),
    constraints: { privacy: 'local-only' },
    request: { messages: [user] },
    maxFallbacks: 1,
  });
  line('local-only without ollama selected', refused.selected);
  if (refused.selected !== null) {
    throw new Error('smoke: local-only selected a cloud provider');
  }

  const result = await execute(
    { messages: [user], constraints: { privacy: 'any' } },
    { adapters },
  );
  line('execute adapter', result.adapterId);
  line('execute provenance', {
    routing: result.routing.basis,
    cost: result.cost.basis,
    latency: result.latency.basis,
    quality: result.evaluation.quality.estimate.basis,
  });
}

async function live(): Promise<void> {
  console.log('--- live providers (from env) ---');
  const env = process.env;
  const adapters = adaptersFromEnv({ env });
  for (const a of adapters) {
    line(`${a.id} configured`, a.configured());
  }
  const runtime = createRuntime({ adapters, env });
  const enabled = adapters.filter((a) => a.configured());
  if (enabled.length === 0) {
    line('live', 'skipped — set ARK_OLLAMA_URL / DEEPSEEK_API_KEY / ARK_FRONTIER_* / ARK_BEDROCK_* to attempt a real call');
    return;
  }

  const privacy = env.ARK_RUNTIME_PRIVACY === 'local-only' ? 'local-only' : 'any';
  try {
    const result = await execute(
      {
        messages: [user],
        maxTokens: 16,
        temperature: 0,
        constraints: { privacy },
        application: 'ark-runtime-smoke',
      },
      runtime,
    );
    line('live adapter', result.adapterId);
    line('live model', result.modelId);
    line('live latencyMs', result.latencyMs);
    line('live routing', result.routing.rationale);
    line('live telemetry', result.telemetry);
    line('live textChars', result.text.length);
  } catch (err) {
    if (err instanceof PolicyError) {
      line('live policy refusal', err.routing.rationale);
      return;
    }
    line('live error', err instanceof Error ? err.message : String(err));
  }
}

await dryRun();
await live();
console.log('smoke ok');
