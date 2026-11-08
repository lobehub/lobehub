import { describe, expect, it } from 'vitest';

import { applyDomainRound, batchDomains, NORMALIZE_BATCH, resolveDomain } from '../service';

describe('domain merge batches', () => {
  it('never puts more than one batch worth of keys in a merge call', () => {
    const counts = Object.fromEntries(Array.from({ length: 615 }, (_, i) => [`product/d${i}`, 1]));
    const batches = batchDomains(counts);

    expect(batches.every((b) => Object.keys(b).length <= NORMALIZE_BATCH)).toBe(true);
    expect(batches.flatMap((b) => Object.keys(b)).sort()).toEqual(Object.keys(counts).sort());
  });

  it('keeps similar domains together', () => {
    const [first, second] = batchDomains({ 'a/x': 1, 'b/y': 1, 'a/w': 1, 'b/z': 1 }, 2);

    expect(Object.keys(first)).toEqual(['a/w', 'a/x']);
    expect(Object.keys(second)).toEqual(['b/y', 'b/z']);
  });

  it('sums merged domains and follows a key through every round', () => {
    const round1 = { 'p/task-a': 'p/tasks', 'p/task-b': 'p/tasks' };
    const round2 = { 'p/tasks': 'p/task-system' };

    expect(applyDomainRound({ 'p/other': 1, 'p/task-a': 2, 'p/task-b': 3 }, round1)).toEqual({
      'p/other': 1,
      'p/tasks': 5,
    });
    expect(resolveDomain('p/task-a', [round1, round2])).toBe('p/task-system');
    expect(resolveDomain('p/other', [round1, round2])).toBe('p/other');
  });
});
