import type {
  GoalRolloutTrigger as GoalRolloutTriggerType,
  GoalStatus as GoalStatusType,
  GoalSubjectType as GoalSubjectTypeType,
} from '@lobechat/types';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  goalClarificationIslandKey,
  goalRolloutTriggers,
  goalStatuses,
  goalSubjectTypes,
  MAX_ISLAND_DISMISSALS,
  mergeIslandDismissals,
} from './goal';

describe('goal consts', () => {
  it('stays in sync with the @lobechat/types unions', () => {
    expectTypeOf<(typeof goalStatuses)[number]>().toEqualTypeOf<GoalStatusType>();
    expectTypeOf<(typeof goalSubjectTypes)[number]>().toEqualTypeOf<GoalSubjectTypeType>();
    expectTypeOf<(typeof goalRolloutTriggers)[number]>().toEqualTypeOf<GoalRolloutTriggerType>();
  });

  it('keeps terminal states last-ish sanity', () => {
    expect(goalStatuses).toContain('achieved');
    expect(goalSubjectTypes).toContain('task');
    expect(goalRolloutTriggers).toContain('canary');
  });
});

describe('island dismissal keys', () => {
  const round = (goalId: string, decisionIds: string[]) => ({
    goalId,
    questions: decisionIds.map((decisionId) => ({ decisionId })),
  });

  it('tells two clarification rounds of the same goal apart', () => {
    expect(goalClarificationIslandKey(round('g1', ['d1', 'd2']))).not.toBe(
      goalClarificationIslandKey(round('g1', ['d3'])),
    );
  });

  it('adds only new keys and returns the same list when nothing is new', () => {
    const current = ['a'];
    expect(mergeIslandDismissals(current, ['b', 'a', 'b'])).toEqual(['a', 'b']);
    expect(mergeIslandDismissals(current, ['a'])).toBe(current);
  });

  it('keeps only the newest keys once the cap is reached', () => {
    const full = Array.from({ length: MAX_ISLAND_DISMISSALS }, (_, i) => `k${i}`);
    const next = mergeIslandDismissals(full, ['new']);
    expect(next).toHaveLength(MAX_ISLAND_DISMISSALS);
    expect(next[0]).toBe('k1');
    expect(next.at(-1)).toBe('new');
  });
});
