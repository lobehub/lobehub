import { describe, expect, it } from 'vitest';

import {
  applyDomainRound,
  batchDomains,
  mergeDomainRounds,
  NORMALIZE_BATCH,
  resolveDomain,
} from '../service';

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

  it('moves the batch boundaries when a round is shifted', () => {
    const [first] = batchDomains({ 'a/w': 1, 'a/x': 1, 'b/y': 1, 'b/z': 1 }, 2, 1);

    expect(Object.keys(first)).toEqual(['a/x', 'b/y']);
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

  const mergeAliases =
    (calls: string[][]) =>
    async (_round: number, _batch: number, counts: Record<string, number>) => {
      const keys = Object.keys(counts);
      calls.push(keys);
      const out: Record<string, string> = {};
      // Stands in for the model: two spellings of one domain merge only if it sees both.
      if (keys.includes('project/task') && keys.includes('project/tasks')) {
        out['project/task'] = 'project/tasks';
        out['project/tasks'] = 'project/tasks';
      }
      return out;
    };

  it('compares domains that a batch boundary cut apart', async () => {
    const counts: Record<string, number> = Object.fromEntries(
      Array.from({ length: 79 }, (_, i) => [`a/d${i}`, 1]),
    );
    counts['project/task'] = 2;
    counts['project/tasks'] = 3;
    const calls: string[][] = [];

    const rounds = await mergeDomainRounds(counts, mergeAliases(calls));

    expect(calls[0]).not.toContain('project/tasks');
    expect(resolveDomain('project/task', rounds)).toBe('project/tasks');
    expect(resolveDomain('project/tasks', rounds)).toBe('project/tasks');
  });

  it('moves the boundaries once before accepting a mapping that merges nothing', async () => {
    const counts = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`a/d${i}`, 1]));
    const calls: string[][] = [];

    const rounds = await mergeDomainRounds(counts, mergeAliases(calls));

    // Round 1 keeps the sorted split, round 2 moves it, then the mapping is final.
    expect(rounds).toHaveLength(2);
    expect(calls).toHaveLength(6);
    expect(calls[3]).not.toEqual(calls[0]);
  });
});
