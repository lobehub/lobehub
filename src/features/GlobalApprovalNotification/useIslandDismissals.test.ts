import { describe, expect, it } from 'vitest';

import {
  appendDismissedIslandKey,
  goalClarificationIslandKey,
  MAX_DISMISSED_ISLAND_KEYS,
} from './useIslandDismissals';

const round = (goalId: string, decisionIds: string[]) => ({
  agentId: null,
  goalId,
  questions: decisionIds.map((decisionId) => ({ decisionId }) as any),
  title: goalId,
});

describe('appendDismissedIslandKey', () => {
  it('appends a new key and leaves a known one alone', () => {
    const current = ['a'];
    expect(appendDismissedIslandKey(current, 'b')).toEqual(['a', 'b']);
    expect(appendDismissedIslandKey(current, 'a')).toBe(current);
  });

  it('keeps only the newest keys once the cap is reached', () => {
    const full = Array.from({ length: MAX_DISMISSED_ISLAND_KEYS }, (_, i) => `k${i}`);
    const next = appendDismissedIslandKey(full, 'new');
    expect(next).toHaveLength(MAX_DISMISSED_ISLAND_KEYS);
    expect(next[0]).toBe('k1');
    expect(next.at(-1)).toBe('new');
  });
});

describe('goalClarificationIslandKey', () => {
  it('tells two rounds of the same goal apart', () => {
    expect(goalClarificationIslandKey(round('g1', ['d1', 'd2']))).not.toBe(
      goalClarificationIslandKey(round('g1', ['d3'])),
    );
  });
});
