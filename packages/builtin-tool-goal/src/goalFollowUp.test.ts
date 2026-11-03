import { describe, expect, it } from 'vitest';

import { hasUnfinishedGoalProposal } from './goalFollowUp';

const goalCall = (pluginState?: Record<string, unknown>, identifier = 'builtin-goal') => ({
  plugin: { apiName: 'createGoal', identifier },
  pluginState,
  role: 'tool',
});

describe('hasUnfinishedGoalProposal', () => {
  it('is false without any createGoal call', () => {
    expect(hasUnfinishedGoalProposal([{ role: 'user' }, { role: 'assistant' }])).toBe(false);
  });

  it('is true when the latest proposal was rejected or blocked', () => {
    expect(hasUnfinishedGoalProposal([{ role: 'user' }, goalCall()])).toBe(true);
    expect(
      hasUnfinishedGoalProposal([goalCall({ reason: 'tool_name_unresolved', type: 'blocked' })]),
    ).toBe(true);
  });

  it('accepts calls persisted under the legacy identifier', () => {
    expect(hasUnfinishedGoalProposal([goalCall(undefined, 'lobe-goal')])).toBe(true);
  });

  it('is false once the latest proposal created a goal', () => {
    expect(
      hasUnfinishedGoalProposal([goalCall(), { role: 'user' }, goalCall({ goalId: 'goal_1' })]),
    ).toBe(false);
  });

  it('ignores createGoal on other tools', () => {
    expect(hasUnfinishedGoalProposal([goalCall(undefined, 'lobe-task')])).toBe(false);
  });
});
