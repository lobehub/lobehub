import { describe, expect, it } from 'vitest';

import { durationKey, partitionByDuration } from './shardByDuration';

const split = (weights: Record<string, number>, count: number) =>
  partitionByDuration(
    Object.keys(weights),
    count,
    (key) => weights[key],
    (key) => key,
  );

describe('partitionByDuration', () => {
  it('balances by weight rather than by count', () => {
    const parts = split({ a: 9, b: 5, c: 4, d: 3, e: 3, f: 2 }, 3);
    const totals = parts.map((part) =>
      part.reduce((sum, key) => sum + { a: 9, b: 5, c: 4, d: 3, e: 3, f: 2 }[key]!, 0),
    );
    expect(totals).toEqual([9, 8, 9]);
    expect(parts.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('gives every shard job the same split whatever order the files arrive in', () => {
    const weights = { 'a.test.ts': 1, 'b.test.ts': 1, 'c.test.ts': 1, 'd.test.ts': 2 };
    const forward = split(weights, 2);
    const reversed = partitionByDuration(
      Object.keys(weights).reverse(),
      2,
      (key) => weights[key as keyof typeof weights],
      (key) => key,
    );
    expect(reversed).toEqual(forward);
  });

  it('leaves extra shards empty when there are fewer files than shards', () => {
    expect(split({ only: 3 }, 3)).toEqual([['only'], [], []]);
  });
});

describe('durationKey', () => {
  it('is the project name and the posix path relative to the root', () => {
    expect(durationKey('server', '/repo', '/repo/apps/server/src/a.test.ts')).toBe(
      'server:apps/server/src/a.test.ts',
    );
  });
});
