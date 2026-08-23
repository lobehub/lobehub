import { DEFAULT_GOAL_MAX_ROUNDS, DEFAULT_MAX_REPAIR_ROUNDS } from '@lobechat/const/verify';
import { describe, expect, it } from 'vitest';

import { buildGoalTaskConfig, deriveInitialGoalCriterionTitle } from './goalConfig';

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

describe('buildGoalTaskConfig', () => {
  it('keeps the round budget and the repair budget independent', () => {
    // Regression: the create-goal path used to reuse the task modal and write the
    // same number into both caps, so a 10-round goal also bought 10 auto-repair
    // re-runs per round (up to 100 agent runs).
    const payload = buildGoalTaskConfig({ instruction: 'ship it', roundBudget: 10 });

    expect(payload.goal.maxRounds).toBe(10);
    expect(payload.config.verify.maxIterations).toBe(DEFAULT_MAX_REPAIR_ROUNDS);
  });

  it('falls back to the documented round default when the budget is untouched', () => {
    expect(buildGoalTaskConfig({ instruction: 'ship it' }).goal.maxRounds).toBe(
      DEFAULT_GOAL_MAX_ROUNDS,
    );
  });

  it('preserves an explicit opt-out of the round cap', () => {
    expect(
      buildGoalTaskConfig({ instruction: 'ship it', roundBudget: null }).goal.maxRounds,
    ).toBeNull();
  });

  it('clamps a round budget to the supported range', () => {
    expect(buildGoalTaskConfig({ instruction: 'x', roundBudget: 1 }).goal.maxRounds).toBe(2);
    expect(buildGoalTaskConfig({ instruction: 'x', roundBudget: 99 }).goal.maxRounds).toBe(10);
  });

  it('writes a positive cost budget and leaves it independent of the round budget', () => {
    const payload = buildGoalTaskConfig({ instruction: 'x', roundBudget: 5, costBudget: 2.5 });

    expect(payload.goal.maxTotalCost).toBe(2.5);
    expect(payload.goal.maxRounds).toBe(5);
  });

  it('maps a blank or non-positive cost budget to uncapped (null)', () => {
    // The goal loop reads `null` as "no cap"; an empty or 0 input must not become a
    // 0-dollar budget that would stop the goal before its first run.
    expect(buildGoalTaskConfig({ instruction: 'x' }).goal.maxTotalCost).toBeNull();
    expect(buildGoalTaskConfig({ instruction: 'x', costBudget: 0 }).goal.maxTotalCost).toBeNull();
    expect(
      buildGoalTaskConfig({ instruction: 'x', costBudget: null }).goal.maxTotalCost,
    ).toBeNull();
  });

  it('uses the acceptance requirement when given', () => {
    const payload = buildGoalTaskConfig({
      instruction: 'clear the P0 backlog',
      requirement: 'every P0 has a linked PR with green CI',
    });

    expect(payload.config.verify.requirement).toBe('every P0 has a linked PR with green CI');
    expect(payload.goal.requirement).toBe('every P0 has a linked PR with green CI');
    expect(payload.config.verify.enabled).toBe(true);
  });

  it('associates user-reviewed acceptance criteria with the goal', () => {
    const payload = buildGoalTaskConfig({
      instruction: 'clear the P0 backlog',
      verifyCriteriaIds: ['criterion-1', 'criterion-2'],
    });

    expect(payload.config.verify.verifyCriteriaIds).toEqual(['criterion-1', 'criterion-2']);
  });

  it('falls back to the instruction so the goal stays judgeable', () => {
    // An empty requirement would leave `planInstantiation` with no source for the
    // holistic check, i.e. a goal that can never be accepted.
    const payload = buildGoalTaskConfig({
      instruction: 'clear the P0 backlog',
      requirement: '   ',
    });

    expect(payload.config.verify.requirement).toBe('clear the P0 backlog');
    expect(payload.goal.requirement).toBe('clear the P0 backlog');
  });
});
