import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { telemetryBasis, dollarBasis, projectionBasis, weaker, TRACE_FLOOR } from './basis.ts';

describe('telemetryBasis', () => {
  test('counts and rates from ingested telemetry are measured, n = traces', () => {
    const b = telemetryBasis(2230);
    assert.equal(b.basis, 'measured');
    assert.equal(b.sampleSize, 2230);
    assert.equal(b.belowFloor, false);
    assert.match(b.source, /2,230 traces/);
    assert.doesNotMatch(b.source, /floor/);
  });

  test('below the floor it is still measured, and says it is thin', () => {
    const b = telemetryBasis(TRACE_FLOOR - 1);
    assert.equal(b.basis, 'measured');
    assert.equal(b.belowFloor, true);
    assert.match(b.source, /below the 30-trace floor/);
  });
});

describe('dollarBasis', () => {
  test('measured only when every event carried a caller-reported cost', () => {
    const b = dollarBasis(100, { events: 400, reportedCostEvents: 400 });
    assert.equal(b.basis, 'measured');
    assert.match(b.source, /caller-reported cost on all 400 events/);
  });

  test('one catalog-priced event makes the total calibrated, and the share is stated', () => {
    const b = dollarBasis(100, { events: 400, reportedCostEvents: 399 });
    assert.equal(b.basis, 'calibrated');
    assert.match(b.source, /99% of events carried a caller-reported cost/);
    assert.match(dollarBasis(100, { events: 400, reportedCostEvents: 1 }).source, /<1% of events/);
    assert.match(b.source, /catalog list rates — not your invoice/);
    const half = dollarBasis(100, { events: 400, reportedCostEvents: 200 });
    assert.match(half.source, /50% of events carried a caller-reported cost/);
  });

  test('nothing reported reads as priced from the catalog, not as the bill', () => {
    const b = dollarBasis(2230, { events: 12520, reportedCostEvents: 0 });
    assert.equal(b.basis, 'calibrated');
    assert.equal(b.sampleSize, 2230);
    assert.equal(b.source, 'observed tokens from 2,230 traces, priced at catalog list rates — not your invoice');
  });

  test('unrecorded provenance is never promoted to measured', () => {
    const b = dollarBasis(2230, { events: 12520, reportedCostEvents: null });
    assert.equal(b.basis, 'calibrated');
    assert.match(b.source, /does not record which costs a caller reported/);
  });

  test('no events is not "all reported"', () => {
    assert.equal(dollarBasis(0, { events: 0, reportedCostEvents: 0 }).basis, 'calibrated');
  });

  test('below the floor the source says so', () => {
    const b = dollarBasis(12, { events: 30, reportedCostEvents: 30 });
    assert.equal(b.basis, 'measured');
    assert.equal(b.belowFloor, true);
    assert.match(b.source, /below the 30-trace floor/);
  });
});

describe('projectionBasis and weaker', () => {
  test('a projection is heuristic whatever it rests on', () => {
    const from = dollarBasis(100, { events: 400, reportedCostEvents: 400 });
    const p = projectionBasis(from, 'straight-line to month end');
    assert.equal(p.basis, 'heuristic');
    assert.equal(p.sampleSize, 100);
    assert.match(p.source, /straight-line to month end, from measured figures over 100 traces/);
  });

  test('weaker picks the lower basis in either order', () => {
    assert.equal(weaker('measured', 'calibrated'), 'calibrated');
    assert.equal(weaker('calibrated', 'measured'), 'calibrated');
    assert.equal(weaker('heuristic', 'measured'), 'heuristic');
    assert.equal(weaker('benchmark', 'calibrated'), 'benchmark');
    assert.equal(weaker('measured', 'measured'), 'measured');
  });
});
