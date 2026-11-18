import { describe, expect, it } from 'vitest';

import {
  CASE_LEVELS,
  getCaseDifficulty,
  getCaseLevel,
  levelFromScore,
  levelLabelKey,
  levelTagColor,
  resolveCaseDifficulty,
} from './caseDifficulty';

describe('levelFromScore', () => {
  it.each([
    [0, 'L1'],
    [1, 'L1'],
    [2, 'L2'],
    [3, 'L2'],
    [4, 'L3'],
    [5, 'L3'],
    [6, 'L4'],
    [7, 'L4'],
    [12, 'L4'],
  ])('maps a release difficulty score of %i to %s', (score, level) => {
    expect(levelFromScore(score)).toBe(level);
  });
});

describe('resolveCaseDifficulty', () => {
  it('reads the tier from the release difficulty score before any label', () => {
    expect(
      resolveCaseDifficulty({
        difficulty: { level: 'Advanced', score: 7, signals: ['x'] },
        level: 'Advanced',
      }),
    ).toEqual({ kind: 'level', level: 'L4' });
    expect(resolveCaseDifficulty({ difficulty: { level: 'Advanced', score: 4 } })).toEqual({
      kind: 'level',
      level: 'L3',
    });
  });

  it.each(CASE_LEVELS)('reads a top-level %s without requiring difficulty details', (level) => {
    expect(resolveCaseDifficulty({ level })).toEqual({ kind: 'level', level });
  });

  it.each([
    ['Starter', 'L1'],
    ['Intermediate', 'L2'],
    ['Advanced', 'L3'],
  ])('maps the legacy release label %s to %s when there is no score', (legacy, level) => {
    expect(resolveCaseDifficulty({ level: legacy })).toEqual({ kind: 'level', level });
    expect(resolveCaseDifficulty({ difficulty: { level: legacy } })).toEqual({
      kind: 'level',
      level,
    });
  });

  it.each(['easy', 'medium', 'hard'] as const)(
    'preserves the legacy %s classification',
    (value) => {
      expect(resolveCaseDifficulty({ difficulty: value })).toEqual({ kind: 'legacy', value });
    },
  );

  it('falls back past an unknown top-level level to supported difficulty metadata', () => {
    expect(resolveCaseDifficulty({ difficulty: { level: 'Advanced' }, level: 'unknown' })).toEqual({
      kind: 'level',
      level: 'L3',
    });
    expect(resolveCaseDifficulty({ difficulty: 'easy', level: 'unknown' })).toEqual({
      kind: 'legacy',
      value: 'easy',
    });
  });

  it.each([
    undefined,
    null,
    false,
    1,
    'easy',
    [],
    {},
    { difficulty: null },
    { difficulty: [] },
    { difficulty: {} },
    { difficulty: { level: {} } },
    { difficulty: { level: 'starter' } },
    { difficulty: { level: 'easy' } },
    { difficulty: 'Starter' },
    { difficulty: 'unknown' },
    { level: 'advanced' },
  ])('does not render a label for unsupported metadata: %j', (metadata) => {
    expect(resolveCaseDifficulty(metadata)).toBeUndefined();
  });
});

describe('shared release difficulty helpers', () => {
  it('keeps level, detail and label behavior for LobeBench callers', () => {
    const details = { level: 'Advanced', score: 4, signals: ['tool use'] };
    const testCase = { metadata: { difficulty: details, level: 'Starter' } };
    expect(getCaseLevel(testCase)).toBe('L3');
    expect(getCaseDifficulty(testCase)).toEqual(details);
    expect(getCaseLevel({ metadata: { level: 'Starter' } })).toBe('L1');
    expect(levelLabelKey('L1')).toBe('lobeBench.case.level.L1');
    expect(levelTagColor('L1')).toBe('success');
    expect(levelTagColor('L2')).toBe('processing');
    expect(levelTagColor('L3')).toBe('warning');
    expect(levelTagColor('L4')).toBe('error');
    expect(getCaseLevel({ metadata: { difficulty: { score: 4 } } })).toBe('L3');
    expect(getCaseDifficulty({ metadata: { difficulty: 'easy' } })).toBeUndefined();
  });
});
