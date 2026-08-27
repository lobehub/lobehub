import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import { describe, expect, it } from 'vitest';

import { buildGoalCreateInput, deriveInitialGoalCriterionTitle } from './goalConfig';

describe('deriveInitialGoalCriterionTitle', () => {
  it('uses the instruction when a free-form goal has no dedicated requirement', () => {
    expect(deriveInitialGoalCriterionTitle('  ship the quarterly report  ')).toBe(
      'ship the quarterly report',
    );
  });

  it('prefers a seeded requirement when one is available', () => {
    expect(
      deriveInitialGoalCriterionTitle('ship the quarterly report', '  include all source links  '),
    ).toBe('include all source links');
  });
});

describe('buildGoalCreateInput', () => {
  it('falls back to the documented round default when the budget is untouched', () => {
    expect(buildGoalCreateInput({ instruction: 'ship it' }).maxRounds).toBe(
      DEFAULT_GOAL_MAX_ROUNDS,
    );
  });

  it('preserves an explicit opt-out of the round cap', () => {
    expect(
      buildGoalCreateInput({ instruction: 'ship it', roundBudget: null }).maxRounds,
    ).toBeNull();
  });

  it('clamps a round budget to the supported range', () => {
    expect(buildGoalCreateInput({ instruction: 'x', roundBudget: 1 }).maxRounds).toBe(2);
    expect(buildGoalCreateInput({ instruction: 'x', roundBudget: 99 }).maxRounds).toBe(10);
  });

  it('writes a positive cost budget and leaves it independent of the round budget', () => {
    const input = buildGoalCreateInput({ costBudget: 2.5, instruction: 'x', roundBudget: 5 });

    expect(input.maxTotalCost).toBe(2.5);
    expect(input.maxRounds).toBe(5);
  });

  it('maps a blank or non-positive cost budget to uncapped (null)', () => {
    // The coordinator reads `null` as "no cap"; an empty or 0 input must not
    // become a 0-dollar budget that would stop the goal before its first run.
    expect(buildGoalCreateInput({ instruction: 'x' }).maxTotalCost).toBeNull();
    expect(buildGoalCreateInput({ costBudget: 0, instruction: 'x' }).maxTotalCost).toBeNull();
    expect(buildGoalCreateInput({ costBudget: -3, instruction: 'x' }).maxTotalCost).toBeNull();
  });

  it('falls back to the instruction when no requirement was drafted', () => {
    expect(buildGoalCreateInput({ instruction: '  ship it  ' }).requirement).toBe('ship it');
    expect(
      buildGoalCreateInput({ instruction: 'ship it', requirement: '  all links resolve  ' })
        .requirement,
    ).toBe('all links resolve');
  });
});
