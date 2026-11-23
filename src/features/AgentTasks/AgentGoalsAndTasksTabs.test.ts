import { describe, expect, it } from 'vitest';

import { goalsAndTasksTabPath, resolveGoalsAndTasksTabAction } from './AgentGoalsAndTasksTabs';

describe('goalsAndTasksTabPath', () => {
  it('addresses scheduled tasks as a collection of the tasks route', () => {
    expect(goalsAndTasksTabPath('tasks')).toBe('/tasks');
    expect(goalsAndTasksTabPath('scheduled')).toBe('/tasks?collection=scheduled');
    expect(goalsAndTasksTabPath('goals')).toBe('/goals');
  });

  it('scopes every tab to the agent', () => {
    expect(goalsAndTasksTabPath('tasks', 'agt_1')).toBe('/agent/agt_1/tasks');
    expect(goalsAndTasksTabPath('scheduled', 'agt_1')).toBe(
      '/agent/agt_1/tasks?collection=scheduled',
    );
    expect(goalsAndTasksTabPath('goals', 'agt_1')).toBe('/agent/agt_1/goals');
  });
});

describe('resolveGoalsAndTasksTabAction', () => {
  it('opens scheduled tasks by navigation from the goals page', () => {
    expect(resolveGoalsAndTasksTabAction('scheduled', { agentId: 'agt_1' })).toEqual({
      path: '/agent/agt_1/tasks?collection=scheduled',
      type: 'navigate',
    });
    expect(resolveGoalsAndTasksTabAction('tasks')).toEqual({ path: '/tasks', type: 'navigate' });
  });

  it('switches task collections in place on the tasks page', () => {
    const options = { agentId: 'agt_1', switchesCollectionInPlace: true };

    expect(resolveGoalsAndTasksTabAction('scheduled', options)).toEqual({
      collection: 'scheduled',
      type: 'collection',
    });
    expect(resolveGoalsAndTasksTabAction('tasks', options)).toEqual({
      collection: 'tasks',
      type: 'collection',
    });
  });

  it('still leaves the tasks page for goals', () => {
    expect(
      resolveGoalsAndTasksTabAction('goals', { agentId: 'agt_1', switchesCollectionInPlace: true }),
    ).toEqual({ path: '/agent/agt_1/goals', type: 'navigate' });
  });
});
