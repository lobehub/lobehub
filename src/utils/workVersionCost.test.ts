import { describe, expect, it } from 'vitest';

import { computeWorkVersionCostDeltas, formatWorkVersionCost } from './workVersionCost';

describe('formatWorkVersionCost', () => {
  it('hides missing or zero cost', () => {
    expect(formatWorkVersionCost(null)).toBeNull();
    expect(formatWorkVersionCost(0)).toBeNull();
  });

  it('keeps small cumulative costs visible', () => {
    expect(formatWorkVersionCost(0.000_295)).toBe('$0.0003');
    expect(formatWorkVersionCost(0.03)).toBe('$0.03');
  });
});

describe('computeWorkVersionCostDeltas', () => {
  it('diffs cumulative snapshots within one operation and keeps the first full', () => {
    // Mirrors the real shape: v1 in op A, v2 + v3 in op B where v3's
    // cumulative already contains v2's spend.
    const deltas = computeWorkVersionCostDeltas([
      { cumulativeCost: 0.003_747, id: 'v3', rootOperationId: 'op-b', version: 3 },
      { cumulativeCost: 0.001_83, id: 'v2', rootOperationId: 'op-b', version: 2 },
      { cumulativeCost: 0.000_306, id: 'v1', rootOperationId: 'op-a', version: 1 },
    ]);

    expect(deltas.get('v1')).toBeCloseTo(0.000_306, 6);
    expect(deltas.get('v2')).toBeCloseTo(0.001_83, 6);
    expect(deltas.get('v3')).toBeCloseTo(0.001_917, 6);
    // Deltas sum back to the card total (max per operation, summed).
    const total = [...deltas.values()].reduce((sum: number, cost) => sum + (cost ?? 0), 0);
    expect(total).toBeCloseTo(0.004_053, 6);
  });

  it('treats versions without a rootOperationId as independent operations', () => {
    const deltas = computeWorkVersionCostDeltas([
      { cumulativeCost: 0.002, id: 'v1', rootOperationId: null, version: 1 },
      { cumulativeCost: 0.003, id: 'v2', rootOperationId: null, version: 2 },
    ]);

    expect(deltas.get('v1')).toBe(0.002);
    expect(deltas.get('v2')).toBe(0.003);
  });

  it('skips null costs without breaking the running snapshot chain', () => {
    const deltas = computeWorkVersionCostDeltas([
      { cumulativeCost: 0.001, id: 'v1', rootOperationId: 'op', version: 1 },
      { cumulativeCost: null, id: 'v2', rootOperationId: 'op', version: 2 },
      { cumulativeCost: 0.004, id: 'v3', rootOperationId: 'op', version: 3 },
    ]);

    expect(deltas.get('v1')).toBe(0.001);
    expect(deltas.get('v2')).toBeNull();
    expect(deltas.get('v3')).toBeCloseTo(0.003, 6);
  });

  it('clamps a decreasing snapshot to zero instead of rendering a negative cost', () => {
    const deltas = computeWorkVersionCostDeltas([
      { cumulativeCost: 0.005, id: 'v1', rootOperationId: 'op', version: 1 },
      { cumulativeCost: 0.004, id: 'v2', rootOperationId: 'op', version: 2 },
    ]);

    expect(deltas.get('v2')).toBe(0);
  });
});
