import { describe, expect, it } from 'vitest';

import {
  evaluateHomogeneity,
  HOMOGENEITY_MIN_SIMILARITY,
  maskConcreteNames,
  minPairwiseSimilarity,
  uncoveredAxisValues,
} from './spec';

describe('maskConcreteNames', () => {
  it('masks paths, identifiers and numbers so one recipe reads the same twice', () => {
    const a = maskConcreteNames('Migrate src/store/userStore.ts using the same 3 steps');
    const b = maskConcreteNames('Migrate src/store/topicStore.ts using the same 3 steps');
    expect(a).toBe(b);
  });
});

describe('minPairwiseSimilarity', () => {
  it('is 1 for briefs that are one masked shape', () => {
    const similarity = minPairwiseSimilarity([
      { instruction: 'Move src/a.ts to the new API', title: 'Migrate A' },
      { instruction: 'Move src/b.ts to the new API', title: 'Migrate B' },
    ]);
    expect(similarity).toBeGreaterThanOrEqual(HOMOGENEITY_MIN_SIMILARITY);
  });

  it('falls below the threshold for unrelated briefs', () => {
    const similarity = minPairwiseSimilarity([
      { instruction: 'Write a benchmark paper', title: 'Paper' },
      { instruction: 'Provision a Postgres cluster', title: 'Infra' },
    ]);
    expect(similarity).toBeLessThan(HOMOGENEITY_MIN_SIMILARITY);
  });
});

describe('evaluateHomogeneity', () => {
  const spec = {
    recipeOutline: 'Replace the store with the replica-backed one',
    repeatable: true,
    unitCount: 50,
    variants: [],
  };
  const probes = [
    { instruction: 'Migrate src/a.ts the same way', title: 'Migrate A' },
    { instruction: 'Migrate src/b.ts the same way', title: 'Migrate B' },
  ];

  it('accepts one repeated mould above the threshold', () => {
    expect(evaluateHomogeneity(spec, probes).batch).toBe(true);
  });

  it('refuses a claim that is not repeatable', () => {
    expect(evaluateHomogeneity({ ...spec, repeatable: false }, probes).batch).toBe(false);
  });

  it('refuses a roster below the homogeneous-unit threshold', () => {
    expect(evaluateHomogeneity({ ...spec, unitCount: 2 }, probes).batch).toBe(false);
  });

  it('refuses probes that are not one mould', () => {
    const verdict = evaluateHomogeneity(spec, [
      { instruction: 'Write a benchmark paper', title: 'Paper' },
      { instruction: 'Provision a Postgres cluster', title: 'Infra' },
    ]);
    expect(verdict.batch).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('one reusable transformation');
  });

  it('refuses a claim with no recipe outline', () => {
    expect(evaluateHomogeneity({ ...spec, recipeOutline: undefined }, probes).batch).toBe(false);
  });
});

describe('uncoveredAxisValues', () => {
  it('reports a declared value no probe touches', () => {
    const gaps = uncoveredAxisValues(
      [{ axis: 'cold-start', values: ['yes', 'no'] }],
      [{ instruction: 'Handle a cold-start yes path', title: 'Probe' }],
    );
    expect(gaps).toEqual([{ axis: 'cold-start', value: 'no' }]);
  });

  it('reports nothing when every value is covered', () => {
    const gaps = uncoveredAxisValues(
      [{ axis: 'mode', values: ['cold-start'] }],
      [{ instruction: 'Handle a cold-start path', title: 'Probe' }],
    );
    expect(gaps).toEqual([]);
  });
});
