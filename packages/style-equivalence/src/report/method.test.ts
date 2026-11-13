import { describe, expect, it } from 'vitest';

import type { ReportCase } from './data';
import { aaSummary, conditionScope } from './method';

const entry = (key: string, unstable: string[] = []): ReportCase => ({
  category: unstable.length ? 'blocking' : 'equal',
  key,
  plan: { file: 'src/A.tsx', flags: [] },
  result: { differingConditions: [], gaps: [], rootCauses: [], unstableConditions: unstable },
});

describe('aaSummary', () => {
  it('counts self-comparisons and lists the unstable ones per case', () => {
    expect(
      aaSummary([entry('src/A.tsx|A#0'), entry('src/A.tsx|A#1', ['light/600/force:active'])], 3),
    ).toEqual({
      checks: 6,
      unstable: [{ conditions: ['light/600/force:active'], key: 'src/A.tsx|A#1' }],
    });
  });
});

describe('conditionScope', () => {
  it('says all conditions when a mutation was expected everywhere, otherwise names them', () => {
    expect(conditionScope(['a', 'b'], 2)).toBe('全部 2 种条件');
    expect(conditionScope(['a#0', 'a#1', 'b#0'], 2)).toBe('全部 2 种条件');
    expect(conditionScope(['dark/375/default'], 12)).toBe('dark/375/default');
    expect(conditionScope(['a', 'b', 'c', 'd'], 12)).toBe('12 种条件里的 4 种');
  });
});
