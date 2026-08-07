import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';

import { useGoalStore } from './index';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));
vi.mock('@/services/task', () => ({ taskService: { deleteGoal: vi.fn(), groupList: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  useGoalStore.setState({
    goalListByAgentId: {},
    goalListFilter: 'active',
    goalListInitializedAgentIds: [],
    goalListVisibleLimit: 10,
    goalViewMode: 'list',
  });
});

describe('GoalAction', () => {
  it('stores goal lists independently for each agent', () => {
    useGoalStore.getState().useFetchGoals('agent-1');
    const options = vi.mocked(useClientDataSWR).mock.calls[0][2] as {
      onSuccess: (value: { data: Array<{ tasks: Array<{ id: string }> }> }) => void;
    };

    options.onSuccess({ data: [{ tasks: [{ id: 'goal-1' }] }] });

    expect(useGoalStore.getState().goalListByAgentId['agent-1']).toEqual([{ id: 'goal-1' }]);
    expect(useGoalStore.getState().goalListInitializedAgentIds).toContain('agent-1');
  });

  it('refreshes only the requested agent goal cache', async () => {
    await useGoalStore.getState().refreshGoals('agent-1');

    expect(mutate).toHaveBeenCalledWith(['task:sidebarGroups', 'agent-1:goals-page']);
  });

  it('owns list display state', () => {
    useGoalStore.getState().setGoalListFilter('all');
    useGoalStore.getState().setGoalViewMode('card');
    useGoalStore.getState().loadMoreGoals();

    expect(useGoalStore.getState()).toMatchObject({
      goalListFilter: 'all',
      goalListVisibleLimit: 20,
      goalViewMode: 'card',
    });
  });

  it('deletes a goal subtree through the goal endpoint and removes it from local state', async () => {
    useGoalStore.getState().useFetchGoals('agent-1');
    const options = vi.mocked(useClientDataSWR).mock.calls[0][2] as {
      onSuccess: (value: {
        data: Array<{ tasks: Array<{ id: string; identifier: string }> }>;
      }) => void;
    };
    options.onSuccess({
      data: [
        {
          tasks: [
            { id: 'goal-1', identifier: 'GOAL-1' },
            { id: 'goal-2', identifier: 'GOAL-2' },
          ],
        },
      ],
    });

    await useGoalStore.getState().deleteGoal('agent-1', 'GOAL-1');

    expect(taskService.deleteGoal).toHaveBeenCalledWith('GOAL-1');
    expect(useGoalStore.getState().goalListByAgentId['agent-1']).toEqual([
      { id: 'goal-2', identifier: 'GOAL-2' },
    ]);
  });
});
