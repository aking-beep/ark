import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hintAdapter, isOpenWeightModel, localCatalogId } from './catalog.js';
import { route } from './router.js';
import { trio } from './fake.js';

describe('open-weight catalog', () => {
  test('open-weight families hint to Ollama, not the cloud frontier', () => {
    for (const id of [
      'deepseek-r1',
      'deepseek-r1:8b',
      'smollm2:135m',
      'yi-34b',
      'granite-code',
      'olmo-2',
      'qwen2.5',
      'llama3.2',
      'gemma2',
      'phi3',
      'mixtral',
    ]) {
      assert.equal(hintAdapter(id), 'ollama', id);
      assert.equal(isOpenWeightModel(id), true, id);
    }
  });

  test('hosted DeepSeek chat ids use the Chat Completions adapter', () => {
    assert.equal(hintAdapter('deepseek-chat'), 'openai-compatible');
    assert.equal(hintAdapter('deepseek-reasoner'), 'openai-compatible');
  });

  test('closed-source ids are not treated as Ollama models', () => {
    assert.equal(hintAdapter('gpt-4o'), 'openai-compatible');
    assert.equal(hintAdapter('gpt-5-nano'), 'openai-compatible');
    assert.equal(hintAdapter('amazon.nova-lite-v1:0'), 'bedrock');
    assert.equal(hintAdapter('claude-sonnet-5'), undefined);
    assert.equal(isOpenWeightModel('gpt-4o'), false);
  });

  test('32B open-weight ids price against the 14B local row, not 8B', () => {
    assert.equal(localCatalogId('yi-34b'), 'local-14b');
    assert.equal(localCatalogId('deepseek-r1:70b'), 'local-70b');
    assert.equal(localCatalogId('smollm2:135m'), 'local-8b');
  });

  test('a DeepSeek-R1 request selects Ollama', () => {
    const decision = route({
      adapters: [trio.ollama(), trio.frontier()],
      constraints: { privacy: 'any' },
      request: { messages: [{ role: 'user', content: 'hello' }], model: 'deepseek-r1' },
      maxFallbacks: 1,
    });
    assert.equal(decision.selected, 'ollama');
    assert.deepEqual(decision.fallbacks, ['openai-compatible']);
  });
});
