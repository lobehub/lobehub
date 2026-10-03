import { describe, expect, it } from 'vitest';

import {
  formatWorktreeTimestamp,
  generateWorktreeBranchName,
  WORKTREE_ADJECTIVES,
  WORKTREE_BRANCH_PREFIX,
  WORKTREE_NOUNS,
} from './worktreeName';

const NOW = new Date(2026, 9, 2, 3, 8);

const sample = (times = 500) =>
  Array.from({ length: times }, () => generateWorktreeBranchName({ now: NOW }));

/** A deterministic stand-in for `Math.random` that walks `values` and loops. */
const sequence = (values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length];
};

describe('formatWorktreeTimestamp', () => {
  it('zero-pads local Y/M/D/H/m', () => {
    expect(formatWorktreeTimestamp(new Date(2026, 0, 5, 4, 3))).toBe('202601050403');
  });

  it('reads the local clock rather than UTC', () => {
    // A local-constructed Date read back with local getters round-trips exactly,
    // whatever the machine's offset is. `toISOString()` would not.
    expect(formatWorktreeTimestamp(new Date(2026, 9, 2, 3, 8))).toBe('202610020308');
  });
});

describe('generateWorktreeBranchName', () => {
  it('yields <prefix>/<YYYYMMDDHHmm>-<adjective>-<noun>', () => {
    const shape = new RegExp(`^${WORKTREE_BRANCH_PREFIX}/\\d{12}-[a-z]+-[a-z]+$`);

    for (const name of sample()) {
      expect(name).toMatch(shape);
    }
  });

  it('draws the words from the exported pools', () => {
    const adjectives = new Set<string>(WORKTREE_ADJECTIVES);
    const nouns = new Set<string>(WORKTREE_NOUNS);

    for (const name of sample()) {
      // `wt/202610020308-quiet-hill` → ['wt/202610020308', 'quiet', 'hill']
      const [, adjective, noun] = name.split('-');
      expect(adjectives.has(adjective)).toBe(true);
      expect(nouns.has(noun)).toBe(true);
    }
  });

  it('is deterministic for an injected clock and random source', () => {
    expect(generateWorktreeBranchName({ now: NOW, random: () => 0 })).toBe(
      generateWorktreeBranchName({ now: NOW, random: () => 0 }),
    );
  });

  it('redraws when the drawn name is already taken', () => {
    const taken = generateWorktreeBranchName({ now: NOW, random: () => 0 });

    expect(
      generateWorktreeBranchName({
        exclude: [taken],
        now: NOW,
        random: sequence([0, 0, 0.5, 0.5]),
      }),
    ).not.toBe(taken);
  });

  it('keeps the first draw when nothing it drew is taken', () => {
    expect(
      generateWorktreeBranchName({ exclude: ['wt/202001010000-other-name'], now: NOW }),
    ).toMatch(/^wt\/202610020308-/);
  });

  it('spreads across the pool so repeats are rare', () => {
    expect(new Set(sample(200)).size).toBeGreaterThan(150);
  });
});

describe('worktree name pools', () => {
  const pools = { adjectives: WORKTREE_ADJECTIVES, nouns: WORKTREE_NOUNS };

  it.each(Object.entries(pools))('%s stay lowercase ASCII and unique', (_label, pool) => {
    expect(new Set(pool).size).toBe(pool.length);
    for (const word of pool) expect(word).toMatch(/^[a-z]+$/);
  });
});
