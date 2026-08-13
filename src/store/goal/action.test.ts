import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { getProjectionStoreState, selectTaskGroupList, useProjectionStore } from '@/projection';
import { taskService } from '@/services/task';

import { useGoalStore } from './index';

const SCOPE = 'user-1:personal';
const goal = (id: string, identifier: string) => ({
  assigneeAgentId: 'agent-1',
  description: null,
  id,
  identifier,
  name: identifier,
  status: 'backlog',
  visibility: 'private',
  workspaceId: null,
});
const group = (tasks: ReturnType<typeof goal>[]) => ({
  hasMore: false,
  key: 'goals',
  limit: 100,
  offset: 0,
  tasks,
  total: tasks.length,
});

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => SCOPE,
  isAnonymousScope: () => false,
  isScopeTrusted: () => false,
  useCacheScope: () => SCOPE,
}));
vi.mock('@/services/task', () => ({ taskService: { deleteGoal: vi.fn(), groupList: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  useProjectionStore.setState({ scopes: {} });
  useGoalStore.setState({
    goalListFilter: 'active',
    goalListVisibleLimit: 10,
    goalViewMode: 'list',
  });
});

describe('GoalAction', () => {
  it('commits goal lists independently to their canonical Projection indexes', async () => {
    vi.mocked(taskService.groupList)
      .mockResolvedValueOnce({
        data: [group([goal('goal-1', 'GOAL-1')])],
      } as any)
      .mockResolvedValueOnce({
        data: [group([goal('goal-2', 'GOAL-2')])],
      } as any);

    useGoalStore.getState().useFetchGoals('agent-1');
    useGoalStore.getState().useFetchGoals('agent-2');
    const firstFetcher = vi.mocked(useClientDataSWR).mock.calls[0][1] as () => Promise<unknown>;
    const secondFetcher = vi.mocked(useClientDataSWR).mock.calls[1][1] as () => Promise<unknown>;

    await firstFetcher();
    await secondFetcher();

    const scope = getProjectionStoreState().scopes[SCOPE];
    expect(
      selectTaskGroupList(scope, { agentKey: 'agent-1:goals-page', visibility: 'all' })?.[0].tasks,
    ).toEqual([expect.objectContaining({ id: 'goal-1', identifier: 'GOAL-1' })]);
    expect(
      selectTaskGroupList(scope, { agentKey: 'agent-2:goals-page', visibility: 'all' })?.[0].tasks,
    ).toEqual([expect.objectContaining({ id: 'goal-2', identifier: 'GOAL-2' })]);
  });

  it('uses the complete goal workspace with a project-scoped query and cache', async () => {
    vi.mocked(taskService.groupList).mockResolvedValueOnce({
      data: [group([goal('project-goal-1', 'GOAL-1')])],
    } as any);

    useGoalStore.getState().useFetchGoals(undefined, 'project-1');
    const [key, fetcher] = vi.mocked(useClientDataSWR).mock.calls[0];

    expect(key).toEqual(['task:sidebarGroups', 'project:project-1:goals-page']);
    await (fetcher as () => Promise<unknown>)();

    expect(taskService.groupList).toHaveBeenCalledWith(
      expect.objectContaining({ hasGoal: true, projectId: 'project-1' }),
    );
    const scope = getProjectionStoreState().scopes[SCOPE];
    expect(
      selectTaskGroupList(scope, {
        agentKey: 'project:project-1:goals-page',
        visibility: 'all',
      })?.[0].tasks,
    ).toEqual([expect.objectContaining({ id: 'project-goal-1' })]);
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

  it('deletes a goal subtree from the canonical Projection list', async () => {
    getProjectionStoreState().commitTaskGroupList(
      SCOPE,
      [group([goal('goal-1', 'GOAL-1'), goal('goal-2', 'GOAL-2')])] as any,
      { agentKey: 'agent-1:goals-page', visibility: 'all' },
      100,
    );
    vi.mocked(taskService.deleteGoal).mockResolvedValue(undefined as never);

    await useGoalStore.getState().deleteGoal('agent-1', 'GOAL-1');

    expect(taskService.deleteGoal).toHaveBeenCalledWith('GOAL-1');
    expect(
      selectTaskGroupList(getProjectionStoreState().scopes[SCOPE], {
        agentKey: 'agent-1:goals-page',
        visibility: 'all',
      })?.[0].tasks,
    ).toEqual([expect.objectContaining({ id: 'goal-2', identifier: 'GOAL-2' })]);
  });
});
