import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { budgetAction, strictestAction } from './budget-enforcement.js';

describe('budgetAction', () => {
  test('below the ceiling always allows', () => {
    assert.equal(budgetAction(9, 10, 'block'), 'allow');
    assert.equal(budgetAction(9, 10, 'throttle'), 'allow');
  });

  test('at the ceiling, block refuses and throttle flags', () => {
    assert.equal(budgetAction(10, 10, 'block'), 'block');
    assert.equal(budgetAction(10, 10, 'throttle'), 'throttle');
    assert.equal(budgetAction(10, 10, 'warn'), 'allow');
    assert.equal(budgetAction(10, 10, 'observe'), 'allow');
  });

  test('strictestAction prefers block over throttle over allow', () => {
    assert.equal(strictestAction(['allow', 'throttle']), 'throttle');
    assert.equal(strictestAction(['throttle', 'block']), 'block');
    assert.equal(strictestAction(['allow']), 'allow');
  });
});
