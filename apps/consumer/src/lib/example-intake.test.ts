import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_INTAKE } from './example-intake.js';

test('example intake is the calculate/lookup shape that must be able to say no', () => {
  assert.ok(EXAMPLE_INTAKE.task.includes('calculate'));
  assert.ok(EXAMPLE_INTAKE.task.includes('lookup'));
  assert.equal(EXAMPLE_INTAKE.needsExactAnswer, true);
  assert.equal(EXAMPLE_INTAKE.doesSomething, false);
});
