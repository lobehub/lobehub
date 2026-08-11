/**
 * @vitest-environment happy-dom
 */
import type { TaskListItem } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClientDataSWR } from '@/libs/swr';
import { projectionKeys, taskKeys } from '@/libs/swr/keys';
import { taskService } from '@/services/task';

import { useProjectionStore } from '../../store';
import { selectTaskGroupList } from '../task/selectors';
import { HOME_GOALS_SIGNATURE, useHomeGoalsRequest, useHomeScheduledTasksRequest } from './hooks';
import { selectHomeScheduledTasks } from './selectors';

const SCOPE = 'user-1:personal';
const createdAt = new Date('2026-08-01T00:00:00.000Z');
const updatedAt = new Date('2026-08-02T00:00:00.000Z');

const task = (id: string, status = 'scheduled'): TaskListItem => ({
  accessedAt: updatedAt,
  assigneeAgentId: 'agent-1',
  assigneeUserId: null,
  automationMode: 'schedule',
  completedAt: null,
  config: { goal: { maxIterations: 3 } },
  context: null,
  createdAt,
  createdByAgentId: null,
  createdByUserId: 'user-1',
  currentTopicId: null,
  description: `${id} description`,
  editorData: null,
  error: null,
  heartbeatInterval: null,
  heartbeatTimeout: null,
  id,
  identifier: id.toUpperCase(),
  instruction: `${id} instruction`,
  lastHeartbeatAt: null,
  maxTopics: null,
  name: `${id} name`,
  parentTaskId: null,
  participants: [
    {
      avatar: null,
      backgroundColor: null,
      id: 'agent-1',
      title: 'Agent One',
      type: 'agent',
    },
  ],
  priority: null,
  projectId: null,
  schedulePattern: '0 * * * *',
  scheduleTimezone: 'UTC',
  seq: 1,
  sortOrder: null,
  startedAt: null,
  status,
  totalRunCost: null,
  totalRunDuration: null,
  totalTopics: 2,
  updatedAt,
  visibility: 'public',
  workspaceId: null,
});

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: vi.fn(() => ({
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  })),
}));
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => SCOPE,
  isAnonymousScope: () => false,
  isScopeTrusted: () => false,
  useCacheScope: () => SCOPE,
}));
vi.mock('@/services/task', () => ({
  taskService: { groupList: vi.fn(), list: vi.fn() },
}));

const requestFetcher = (root: string): (() => Promise<unknown>) => {
  const call = vi
    .mocked(useClientDataSWR)
    .mock.calls.find(([key]) => Array.isArray(key) && key[0] === root);
  if (!call) throw new Error(`Missing request for ${root}`);
  return call[1] as () => Promise<unknown>;
};

describe('Home Projection requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectionStore.setState({ scopes: {} });
  });

  it('keeps scheduled tasks in their own Projection index', async () => {
    const scheduled = task('scheduled-1');
    vi.mocked(taskService.list).mockResolvedValue({ data: [scheduled], total: 1 } as never);

    renderHook(() => useHomeScheduledTasksRequest(true));
    await act(async () => requestFetcher(projectionKeys.scheduledTasks.root)());

    const scope = useProjectionStore.getState().scopes[SCOPE];
    expect(taskService.list).toHaveBeenCalledWith({
      automated: true,
      hasGoal: false,
      orderBy: 'updatedAt',
    });
    expect(scope.indexes['home.tasks']).toBeUndefined();
    expect(selectHomeScheduledTasks(scope)).toEqual([
      expect.objectContaining({
        automationMode: 'schedule',
        id: 'scheduled-1',
        schedulePattern: '0 * * * *',
      }),
    ]);
  });

  it('commits the cross-agent goal roll-up to a scoped Task group index', async () => {
    const goal = task('goal-1', 'running');
    vi.mocked(taskService.groupList).mockResolvedValue({
      data: [
        {
          hasMore: false,
          key: 'goals',
          limit: 100,
          offset: 0,
          tasks: [goal],
          total: 1,
        },
      ],
    } as never);

    renderHook(() => useHomeGoalsRequest(true));
    await act(async () => requestFetcher(taskKeys.homeGoals.root)());

    expect(taskService.groupList).toHaveBeenCalledWith({
      groups: [
        { key: 'goals', limit: 100, statuses: ['backlog', 'running', 'scheduled', 'completed'] },
      ],
      hasGoal: true,
      parentTaskId: null,
    });
    expect(
      selectTaskGroupList(useProjectionStore.getState().scopes[SCOPE], HOME_GOALS_SIGNATURE)?.[0]
        .tasks,
    ).toEqual([expect.objectContaining({ id: 'goal-1', identifier: 'GOAL-1' })]);
  });

  it('does not hydrate or fetch Home goals while the feature is disabled', () => {
    renderHook(() => useHomeGoalsRequest(false));

    expect(
      vi
        .mocked(useClientDataSWR)
        .mock.calls.some(([key]) => Array.isArray(key) && key[0] === taskKeys.homeGoals.root),
    ).toBe(false);
  });
});
