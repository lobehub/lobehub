import { DEFAULT_GOAL_MAX_ROUNDS, DEFAULT_MAX_REPAIR_ROUNDS } from '@lobechat/const/verify';
import { describe, expect, it } from 'vitest';

import { buildGoalTaskConfig } from './goalConfig';

describe('buildGoalTaskConfig', () => {
  it('keeps the round budget and the repair budget independent', () => {
    // Regression: the create-goal path used to reuse the task modal and write the
    // same number into both caps, so a 10-round goal also bought 10 auto-repair
    // re-runs per round (up to 100 agent runs).
    const config = buildGoalTaskConfig({ instruction: 'ship it', roundBudget: 10 });

    expect(config.goal.maxIterations).toBe(10);
    expect(config.verify.maxIterations).toBe(DEFAULT_MAX_REPAIR_ROUNDS);
  });

  it('falls back to the documented round default when the budget is untouched', () => {
    expect(buildGoalTaskConfig({ instruction: 'ship it' }).goal.maxIterations).toBe(
      DEFAULT_GOAL_MAX_ROUNDS,
    );
  });

  it('preserves an explicit opt-out of the round cap', () => {
    expect(
      buildGoalTaskConfig({ instruction: 'ship it', roundBudget: null }).goal.maxIterations,
    ).toBeNull();
  });

  it('clamps a round budget to the supported range', () => {
    expect(buildGoalTaskConfig({ instruction: 'x', roundBudget: 1 }).goal.maxIterations).toBe(2);
    expect(buildGoalTaskConfig({ instruction: 'x', roundBudget: 99 }).goal.maxIterations).toBe(10);
  });

  it('uses the acceptance requirement when given', () => {
    const config = buildGoalTaskConfig({
      instruction: 'clear the P0 backlog',
      requirement: 'every P0 has a linked PR with green CI',
    });

    expect(config.verify.requirement).toBe('every P0 has a linked PR with green CI');
    expect(config.verify.enabled).toBe(true);
  });

  it('falls back to the instruction so the goal stays judgeable', () => {
    // An empty requirement would leave `planInstantiation` with no source for the
    // holistic check, i.e. a goal that can never be accepted.
    const config = buildGoalTaskConfig({
      instruction: 'clear the P0 backlog',
      requirement: '   ',
    });

    expect(config.verify.requirement).toBe('clear the P0 backlog');
  });
});
