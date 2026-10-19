import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT_TRIAGE, Workload, urlCodec, encodeForUrlClient } from '@ark/core';
import {
  LAST_STEP,
  PLACEHOLDERS,
  STORAGE_KEY,
  blockedReason,
  clearSaved,
  emptyIntake,
  firstIncompleteStep,
  loadSaved,
  parseStep,
  placeholderKeysFromId,
  save,
  shortCircuitWorkload,
  stateFromWorkload,
  workloadFromState,
  type IntakeState,
  type KeyValueStore,
} from './intake-state.ts';

function complete(): IntakeState {
  return {
    ...emptyIntake(),
    name: 'Triage tickets',
    task: ['classify'],
    unitsPerMonth: 3000,
    unitLabel: 'ticket',
    inTokens: 900,
    outTokens: 120,
    determinism: 'tolerant',
    errorTolerance: 'medium',
    dataClasses: ['internal', 'pii'],
    latencyBudgetMs: 5000,
    engineers: 0,
  };
}

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const throwingStore: KeyValueStore = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); },
};

describe('no invented workload', () => {
  test('the empty intake sizes nothing', () => {
    const s = emptyIntake();
    for (const k of ['unitsPerMonth', 'unitLabel', 'inTokens', 'outTokens', 'determinism', 'errorTolerance', 'latencyBudgetMs', 'engineers'] as const) {
      assert.equal(s[k], '', `${k} must start empty`);
    }
    assert.deepEqual(s.dataClasses, []);
    // The honest null choices stay, visibly selected.
    assert.equal(s.actor, 'employee');
    assert.equal(s.variability, 'steady');
    assert.equal(s.autonomy, 'suggest');
    assert.equal(s.dataResidency, 'any');
    assert.deepEqual(s.regulated, ['none']);
  });

  test('every required step blocks until answered, with a reason', () => {
    const s = emptyIntake();
    assert.equal(blockedReason(0, s), 'Name the job and pick at least one shape.');
    assert.match(blockedReason(1, s)!, /units arrive a month.*and say what a unit is called/);
    assert.match(blockedReason(2, s)!, /input tokens.*and enter output tokens/);
    assert.match(blockedReason(3, s)!, /how exact.*and choose what happens/);
    assert.equal(blockedReason(4, s), 'Pick at least one data class.');
    assert.equal(blockedReason(5, s), 'Choose a latency budget.');
    assert.equal(blockedReason(6, s), null, 'Today is optional');
    assert.match(blockedReason(7, s)!, /0 is an answer/);
    assert.equal(blockedReason(0, { ...s, name: 'Job' }), 'Pick at least one shape.');
    assert.equal(blockedReason(1, { ...s, unitsPerMonth: 0, unitLabel: 'x' })!.startsWith('Enter how many'), true);
  });

  test('zero engineers is an answer', () => {
    assert.equal(blockedReason(7, { ...emptyIntake(), engineers: 0 }), null);
  });

  test('workloadFromState refuses until complete, then parses', () => {
    assert.equal(workloadFromState(emptyIntake()), null);
    assert.equal(workloadFromState({ ...complete(), latencyBudgetMs: '' }), null);
    const w = workloadFromState(complete(), 0)!;
    const parsed = Workload.safeParse(w);
    assert.ok(parsed.success);
    assert.equal(w.volume.unitsPerMonth, 3000);
    assert.equal(w.latencyBudgetMs, 5000);
    assert.deepEqual(w.current, {}, 'blank Today stays unknown');
    assert.equal(firstIncompleteStep(complete()), null);
    assert.equal(firstIncompleteStep({ ...complete(), dataClasses: [] }), 4);
  });

  test('human error rate is a percent in the form and a fraction in the workload', () => {
    const w = workloadFromState({ ...complete(), humanErrorRate: 7.5, minutesPerUnit: 4 })!;
    assert.equal(w.current.humanErrorRate, 0.075);
    assert.equal(w.current.minutesPerUnit, 4);
  });
});

describe('short-circuit workload (scope=verdict contract)', () => {
  test('needs a name and a shape', () => {
    assert.equal(shortCircuitWorkload(emptyIntake()), null);
    assert.equal(shortCircuitWorkload({ ...emptyIntake(), task: ['lookup'] }), null);
  });

  test('fills only unanswered fields with placeholders and records them in the id', () => {
    const s = { ...emptyIntake(), name: 'Invoice lookup', task: ['lookup' as const], unitsPerMonth: 500 as const };
    const w = shortCircuitWorkload(s, 0)!;
    assert.ok(Workload.safeParse(w).success);
    assert.equal(w.volume.unitsPerMonth, 500, 'an answered field is kept');
    assert.equal(w.volume.unitLabel, PLACEHOLDERS.unitLabel);
    assert.equal(w.input.avgTokens, 1);
    assert.deepEqual(w.dataClasses, ['internal']);
    const keys = placeholderKeysFromId(w.id);
    assert.ok(!keys.includes('unitsPerMonth'));
    assert.ok(keys.includes('unitLabel') && keys.includes('engineers') && keys.includes('latencyBudgetMs'));
  });

  test('"Continue the full assessment" reopens placeholders empty, through the real codec', () => {
    const s = { ...emptyIntake(), name: 'Rate calc', task: ['calculate' as const], description: 'Apply the rate card.' };
    const encoded = encodeForUrlClient(shortCircuitWorkload(s)!);
    const decoded = urlCodec(Workload).decode(encoded)!;
    assert.ok(decoded, 'the client encoding decodes on the server');
    const back = stateFromWorkload(decoded);
    assert.equal(back.name, 'Rate calc');
    assert.equal(back.description, 'Apply the rate card.');
    assert.deepEqual(back.task, ['calculate']);
    for (const k of ['unitsPerMonth', 'unitLabel', 'inTokens', 'outTokens', 'determinism', 'errorTolerance', 'latencyBudgetMs', 'engineers'] as const) {
      assert.equal(back[k], '', `${k} must not come back as a placeholder`);
    }
    assert.deepEqual(back.dataClasses, []);
  });
});

describe('edit answers (prefill from w)', () => {
  test('a full workload round-trips through the state', () => {
    const w = workloadFromState({ ...complete(), humanErrorRate: 3, hourlyUsd: 60, actions: [{ name: 'refund', system: 'Stripe', write: true, blastRadius: 'costly' }] }, 0)!;
    const back = stateFromWorkload(Workload.parse(w));
    const again = workloadFromState(back, 0);
    assert.deepEqual(again, w);
  });

  test('a latency that is not one of the four options comes back unselected', () => {
    const back = stateFromWorkload(SUPPORT_TRIAGE);
    assert.ok([1000, 5000, 30000, 600000, ''].includes(back.latencyBudgetMs as number | ''));
    const odd = stateFromWorkload(Workload.parse({ ...SUPPORT_TRIAGE, latencyBudgetMs: 10_000 }));
    assert.equal(odd.latencyBudgetMs, '');
  });

  test('ordinary ids carry no placeholder keys', () => {
    assert.deepEqual(placeholderKeysFromId('w_abc'), []);
    assert.deepEqual(placeholderKeysFromId('w_verdict_x__unitLabel.bogus'), ['unitLabel']);
  });
});

describe('step param', () => {
  test('accepts 0..7 only', () => {
    assert.equal(parseStep('0'), 0);
    assert.equal(parseStep(String(LAST_STEP)), LAST_STEP);
    assert.equal(parseStep('8'), null);
    assert.equal(parseStep('-1'), null);
    assert.equal(parseStep('1.5'), null);
    assert.equal(parseStep(undefined), null);
    assert.equal(parseStep(['1', '2']), null);
  });
});

describe('session persistence', () => {
  test('saves, restores and clears', () => {
    const store = memoryStore();
    save(store, { step: 3, state: complete() });
    assert.deepEqual(loadSaved(store), { step: 3, state: complete() });
    clearSaved(store);
    assert.equal(loadSaved(store), null);
  });

  test('a pristine form is never saved, so it is never "restored"', () => {
    const store = memoryStore();
    save(store, { step: 2, state: complete() });
    save(store, { step: 0, state: emptyIntake() });
    assert.equal(store.map.size, 0);
    assert.equal(loadSaved(store), null);
  });

  test('unavailable or throwing storage is not an error', () => {
    assert.equal(loadSaved(null), null);
    assert.equal(loadSaved(throwingStore), null);
    assert.doesNotThrow(() => save(throwingStore, { step: 0, state: emptyIntake() }));
    assert.doesNotThrow(() => clearSaved(throwingStore));
  });

  test('malformed drafts lose the bad field, never gain a default', () => {
    const store = memoryStore();
    store.setItem(STORAGE_KEY, 'not json');
    assert.equal(loadSaved(store), null);
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({ step: 99, state: { name: 'Kept', unitsPerMonth: 'lots', latencyBudgetMs: 10000, task: ['classify', 'nope'], determinism: 'exact' } }),
    );
    const got = loadSaved(store)!;
    assert.equal(got.step, 0);
    assert.equal(got.state.name, 'Kept');
    assert.equal(got.state.unitsPerMonth, '');
    assert.equal(got.state.latencyBudgetMs, '');
    assert.deepEqual(got.state.task, []);
    assert.equal(got.state.determinism, 'exact');
    assert.deepEqual(got.state.regulated, ['none']);
  });
});
