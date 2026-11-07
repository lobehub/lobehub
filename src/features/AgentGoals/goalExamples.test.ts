import { GOAL_MAX_ROUNDS_RANGE } from '@lobechat/const/verify';
import { describe, expect, it } from 'vitest';

import {
  buildGoalExampleSeed,
  GOAL_EXAMPLE_KEYS,
  GOAL_EXAMPLE_ROUND_BUDGETS,
} from './goalExamples';

describe('goalExamples', () => {
  it('seeds every field the create-goal modal prefills from', () => {
    // A card that opens an empty form teaches nothing, so the seed has to carry
    // the title, the acceptance bar and the budget together.
    expect(buildGoalExampleSeed('digest', (key) => key)).toEqual({
      requirement: 'goalEmpty.examples.digest.requirement',
      roundBudget: 3,
      title: 'goalEmpty.examples.digest.title',
    });
  });

  it('keeps every example budget inside the supported round range', () => {
    // Out-of-range seeds would be silently clamped on submit, so the offered
    // example would not be the goal the user actually got.
    for (const key of GOAL_EXAMPLE_KEYS) {
      const budget = GOAL_EXAMPLE_ROUND_BUDGETS[key];
      expect(budget).toBeGreaterThanOrEqual(GOAL_MAX_ROUNDS_RANGE.min);
      expect(budget).toBeLessThanOrEqual(GOAL_MAX_ROUNDS_RANGE.max);
    }
  });
});
