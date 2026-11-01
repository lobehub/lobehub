import { describe, expect, it } from 'vitest';

import { goalItemPath } from './goalItemPath';

describe('goalItemPath', () => {
  it('opens the bare route from the cross-agent list, even for an agent’s goal', () => {
    expect(goalItemPath({ agentId: 'agt-1', crossAgent: true, goalId: 'goal-1' })).toBe(
      '/goal/goal-1',
    );
  });

  it('opens a goal under its agent on an agent or project page', () => {
    expect(goalItemPath({ agentId: 'agt-1', goalId: 'goal-1' })).toBe('/agent/agt-1/goal/goal-1');
  });

  it('falls back to the bare route for a goal with no agent', () => {
    expect(goalItemPath({ agentId: null, goalId: 'goal-1' })).toBe('/goal/goal-1');
  });
});
