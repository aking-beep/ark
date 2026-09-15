import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens } from './prompt-tokens.js';

describe('estimateTokens', () => {
  test('empty text is zero, not a fabricated 1', () => {
    assert.equal(estimateTokens('').value, 0);
    assert.equal(estimateTokens('   ').value, 0);
  });

  test('four characters is about one token', () => {
    assert.equal(estimateTokens('abcd').value, 1);
    assert.equal(estimateTokens('a'.repeat(400)).value, 100);
  });

  test('the figure is labelled heuristic', () => {
    const e = estimateTokens('You are a helpful assistant.');
    assert.equal(e.basis, 'heuristic');
    assert.match(e.source, /rule of thumb/i);
  });
});
