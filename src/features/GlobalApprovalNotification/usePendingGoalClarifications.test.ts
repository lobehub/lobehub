import { describe, expect, it } from 'vitest';

import {
  type GoalClarificationGroup,
  goalIdFromPath,
  selectIslandGoalClarifications,
} from './usePendingGoalClarifications';

const group = (goalId: string, questions = 1): GoalClarificationGroup => ({
  agentId: 'agt',
  goalId,
  questions: Array.from({ length: questions }, (_, i) => ({
    decisionId: `${goalId}-${i}`,
    options: [],
    question: `q${i}`,
  })),
  title: goalId,
});

describe('goalIdFromPath', () => {
  it('reads the goal on screen from agent, bare and workspace goal routes', () => {
    expect(goalIdFromPath('/agent/agt_1/goal/goal_a')).toBe('goal_a');
    expect(goalIdFromPath('/goal/goal_b')).toBe('goal_b');
    expect(goalIdFromPath('/acme/agent/agt_1/goal/goal_c')).toBe('goal_c');
    expect(goalIdFromPath('/agent/agt_1/goals')).toBeUndefined();
    expect(goalIdFromPath('/agent/agt_1')).toBeUndefined();
  });
});

describe('selectIslandGoalClarifications', () => {
  const groups = [group('goal_a'), group('goal_b'), group('goal_c')];

  it('stays out of a goal page entirely, even for other goals', () => {
    expect(selectIslandGoalClarifications(groups, { onGoalPage: true })).toEqual([]);
  });

  it('skips only the goal open in the portal beside a conversation', () => {
    expect(
      selectIslandGoalClarifications(groups, { onGoalPage: false, portalGoalId: 'goal_b' }).map(
        (g) => g.goalId,
      ),
    ).toEqual(['goal_a', 'goal_c']);
    expect(selectIslandGoalClarifications(groups, { onGoalPage: false })).toHaveLength(3);
  });

  it('drops a goal with nothing left to ask', () => {
    expect(selectIslandGoalClarifications([group('goal_a', 0)], { onGoalPage: false })).toEqual([]);
  });
});
