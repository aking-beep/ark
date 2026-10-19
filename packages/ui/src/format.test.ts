import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt } from './format.ts';

test('a non-zero cost never prints as zero', () => {
  assert.equal(fmt.usd(0.000045, 4), '$0.000045');
  assert.equal(fmt.usd(0.00012, 3), '$0.00012');
  assert.equal(fmt.usd(0), '$0.0000');
  assert.equal(fmt.usd(0.0123), '$0.0123');
  assert.equal(fmt.usd(12.5), '$12.50');
});
