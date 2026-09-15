import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { goalService } from '@/services/goal';

import { useGoalStore } from './index';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));
vi.mock('@/services/goal', () => ({
  goalService: { delete: vi.fn(), list: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useGoalStore.setState({
    goalListByAgentId: {},
    goalListFilter: 'active',
    goalListInitializedAgentIds: [],
    goalListVisibleLimit: 10,
    goalViewMode: 'list',
    homeGoalsByScope: {},
    homeGoalsInitializedScopes: [],
  });
});

describe('GoalAction', () => {
  describe('useFetchGoalGraph', () => {
    const refreshIntervalFor = (status: string) => {
      useGoalStore.getState().useFetchGoalGraph('goal-1');
      const options = vi.mocked(useClientDataSWR).mock.calls.at(-1)?.[2] as {
        refreshInterval: (graph?: { goal: { status: string } }) => number;
      };
      return options.refreshInterval({ goal: { status } });
    };

    it.each(['planning', 'running', 'verifying'])(
      'keeps re-reading a %s goal the server is still advancing',
      (status) => {
        // The goal advances from server events now; without this the page would
        // sit on its first snapshot until the tab lost and regained focus.
        expect(refreshIntervalFor(status)).toBeGreaterThan(0);
      },
    );

    it.each(['review', 'paused', 'achieved', 'failed', 'canceled'])(
      'stops polling a %s goal',
      (status) => {
        // Nothing on the server will move these — the next change comes from a
        // person, and the action that makes it refreshes the snapshot itself.
        expect(refreshIntervalFor(status)).toBe(0);
      },
    );

    it('does not poll before the first snapshot arrives', () => {
      useGoalStore.getState().useFetchGoalGraph('goal-1');
      const options = vi.mocked(useClientDataSWR).mock.calls.at(-1)?.[2] as {
        refreshInterval: (graph?: unknown) => number;
      };

      expect(options.refreshInterval(undefined)).toBe(0);
    });
  });

  it('stores goal lists independently for each agent', () => {
    useGoalStore.getState().useFetchGoals('agent-1');
    const options = vi.mocked(useClientDataSWR).mock.calls[0][2] as {
      onSuccess: (value: { goals: Array<{ id: string }> }) => void;
    };

    options.onSuccess({ goals: [{ id: 'goal-1' }] });

    expect(useGoalStore.getState().goalListByAgentId['agent-1']).toEqual([{ id: 'goal-1' }]);
    expect(useGoalStore.getState().goalListInitializedAgentIds).toContain('agent-1');
  });

  it('queries the goal list endpoint with an agent-scoped query and cache', () => {
    useGoalStore.getState().useFetchGoals('agent-1');
    const [, fetcher] = vi.mocked(useClientDataSWR).mock.calls[0];

    void (fetcher as () => unknown)();
    expect(goalService.list).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-1' }));
  });

  it('uses the complete goal workspace with a project-scoped query and cache', () => {
    useGoalStore.getState().useFetchGoals(undefined, 'project-1');
    const [key, fetcher, options] = vi.mocked(useClientDataSWR).mock.calls[0];

    expect(key).toEqual(['task:sidebarGroups', 'project:project-1:goals-page']);
    expect(fetcher).toBeTypeOf('function');
    void (fetcher as () => unknown)();
    expect(goalService.list).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1' }),
    );

    const onSuccess = (
      options as {
        onSuccess: (value: { goals: Array<{ id: string }> }) => void;
      }
    ).onSuccess;
    onSuccess({ goals: [{ id: 'project-goal-1' }] });

    expect(useGoalStore.getState().goalListByAgentId['project:project-1']).toEqual([
      { id: 'project-goal-1' },
    ]);
  });

  it('keeps each workspace home roll-up apart, so a late response cannot cross scopes', () => {
    useGoalStore.getState().useFetchHomeGoals(true, 'user:ws-a');
    useGoalStore.getState().useFetchHomeGoals(true, 'user:ws-b');
    const optionsOf = (call: number) =>
      vi.mocked(useClientDataSWR).mock.calls[call][2] as {
        onSuccess: (value: { goals: Array<{ id: string }> }) => void;
      };

    // ws-b lands first, then the workspace you already left answers.
    optionsOf(1).onSuccess({ goals: [{ id: 'goal-b' }] });
    optionsOf(0).onSuccess({ goals: [{ id: 'goal-a' }] });

    expect(useGoalStore.getState().homeGoalsByScope).toEqual({
      'user:ws-a': [{ id: 'goal-a' }],
      'user:ws-b': [{ id: 'goal-b' }],
    });
    expect(useGoalStore.getState().homeGoalsInitializedScopes).toEqual(['user:ws-b', 'user:ws-a']);
  });

  it('asks only for statuses rendered by the home roll-up', () => {
    useGoalStore.getState().useFetchHomeGoals(true, 'user:ws-a');
    const fetcher = vi.mocked(useClientDataSWR).mock.calls[0][1] as () => unknown;

    fetcher();

    expect(goalService.list).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['planning', 'running', 'verifying', 'review'],
      }),
    );
    expect(goalService.list).toHaveBeenCalledWith(
      expect.not.objectContaining({
        statuses: expect.arrayContaining(['paused', 'failed', 'achieved', 'canceled']),
      }),
    );
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

  it('deletes a goal through the goal endpoint and removes it from local state', async () => {
    useGoalStore.getState().useFetchGoals('agent-1');
    const options = vi.mocked(useClientDataSWR).mock.calls[0][2] as {
      onSuccess: (value: { goals: Array<{ goal: { id: string } }> }) => void;
    };
    options.onSuccess({ goals: [{ goal: { id: 'goal-1' } }, { goal: { id: 'goal-2' } }] });

    await useGoalStore.getState().deleteGoal('agent-1', 'goal-1');

    expect(goalService.delete).toHaveBeenCalledWith('goal-1');
    expect(useGoalStore.getState().goalListByAgentId['agent-1']).toEqual([
      { goal: { id: 'goal-2' } },
    ]);
  });
});
