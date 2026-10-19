import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaAdapter } from './ollama.js';
import { OpenAICompatibleAdapter } from './openai-compatible.js';
import { ProviderError, type CompletionRequest } from './types.js';

const req: CompletionRequest = { messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 };

/** Headers arrive at once; the body never finishes unless the signal aborts it. */
function stalledBodyFetch(): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const signal = init?.signal;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":'));
        signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
}

function delayedJson(ms: number, body: unknown): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(new Response(JSON.stringify(body), { status: 200 })), ms);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    })) as typeof fetch;
}

describe('provider HTTP deadline', () => {
  test('a body that stalls after headers still times out', async () => {
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: 'https://frontier.test',
      apiKey: 'k',
      model: 'm',
      timeoutMs: 40,
      fetch: stalledBodyFetch(),
    });
    const started = Date.now();
    await assert.rejects(adapter.complete(req), (err) => err instanceof ProviderError && err.kind === 'timeout');
    assert.ok(Date.now() - started < 1000);
  });

  test('Ollama tags + chat share one deadline', async () => {
    // Each call takes 30ms; with a 50ms budget the pair must time out even
    // though neither call alone exceeds it.
    const fetchFn = ((url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const body = path.endsWith('/api/tags')
        ? { models: [{ name: 'llama3.2' }] }
        : { model: 'llama3.2', message: { role: 'assistant', content: 'ok' }, prompt_eval_count: 1, eval_count: 1 };
      return delayedJson(30, body)(url, init);
    }) as typeof fetch;
    const adapter = new OllamaAdapter({ baseUrl: 'http://ollama.test', model: 'llama3.2', timeoutMs: 50, fetch: fetchFn });
    await assert.rejects(adapter.complete(req), (err) => err instanceof ProviderError && err.kind === 'timeout');
    const roomy = new OllamaAdapter({ baseUrl: 'http://ollama.test', model: 'llama3.2', timeoutMs: 500, fetch: fetchFn });
    assert.equal((await roomy.complete(req)).text, 'ok');
  });

  test('a caller signal aborts the request with kind aborted', async () => {
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: 'https://frontier.test',
      apiKey: 'k',
      model: 'm',
      timeoutMs: 5_000,
      fetch: delayedJson(1_000, {}),
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    await assert.rejects(
      adapter.complete(req, { signal: ac.signal }),
      (err) => err instanceof ProviderError && err.kind === 'aborted',
    );
  });

  test('an already-aborted signal never calls fetch', async () => {
    let calls = 0;
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: 'https://frontier.test',
      apiKey: 'k',
      model: 'm',
      fetch: (async () => {
        calls++;
        return new Response('{}');
      }) as typeof fetch,
    });
    await assert.rejects(adapter.complete(req, { signal: AbortSignal.abort() }));
    assert.equal(calls, 0);
  });
});
