import { describe, expect, it } from 'vitest';

import { selectIslandGoalItems } from './usePendingGoalDecisions';

const decision = (goalId: string, decisionId: string) => ({
  agentId: null,
  decisionId,
  description: null,
  goalId,
  goalTitle: goalId,
  nodeTitle: 'Choose how to recover failed task',
  options: [],
  question: 'Retry?',
  recommendedOptionId: 'retry',
  sourceTitle: null,
});
const signOff = (goalId: string) => ({
  acceptanceId: `acc-${goalId}`,
  agentId: null,
  briefId: `brief-${goalId}`,
  goalId,
  goalTitle: goalId,
});

describe('selectIslandGoalItems', () => {
  const data = {
    decisions: [decision('g1', 'd1'), decision('g2', 'd2')],
    signOffs: [signOff('g3')],
  };

  it('asks gates before sign-offs', () => {
    expect(
      selectIslandGoalItems(data, { canAnswer: true, onGoalPage: false }).map((i) => i.key),
    ).toEqual(['goal-decision:d1', 'goal-decision:d2', 'goal-sign-off:acc-g3']);
  });

  it('stays out of a goal page and skips the goal open beside the conversation', () => {
    expect(selectIslandGoalItems(data, { canAnswer: true, onGoalPage: true })).toEqual([]);
    expect(
      selectIslandGoalItems(data, { canAnswer: true, onGoalPage: false, portalGoalId: 'g1' }).map(
        (i) => i.key,
      ),
    ).toEqual(['goal-decision:d2', 'goal-sign-off:acc-g3']);
  });

  it('asks nothing of someone who cannot answer', () => {
    expect(selectIslandGoalItems(data, { canAnswer: false, onGoalPage: false })).toEqual([]);
  });
});
