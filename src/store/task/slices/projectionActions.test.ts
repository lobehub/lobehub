import type { TaskDetailData, TaskListItem } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClientDataSWR } from '@/libs/swr';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState, useProjectionStore } from '@/projection';
import { getTaskDetailProjection } from '@/projection/modules/task/read';
import { taskService } from '@/services/task';

import { useTaskStore } from '../store';

vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useClientDataSWR: vi.fn(() => ({
    data: undefined,
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  })),
}));

vi.mock('@/services/task', () => ({
  taskService: {
    groupList: vi.fn(),
    list: vi.fn(),
  },
}));

const TASK_ID = 'task-1';
const detail = {
  description: 'Detailed description',
  id: TASK_ID,
  identifier: 'TASK-1',
  instruction: 'Keep this private instruction',
  name: 'Initial task',
  status: 'backlog',
} as TaskDetailData;

describe('Task actions backed by Projection', () => {
  beforeEach(() => {
    useProjectionStore.setState({ scopes: {} });
    useTaskStore.setState({ taskInstructionRevisionMap: {}, taskSaveStatusMap: {} });
  });

  it('writes, patches, and deletes task detail through the canonical Projection', () => {
    useTaskStore.getState().internal_dispatchTaskDetail({
      id: TASK_ID,
      type: 'setTaskDetail',
      value: detail,
    });
    expect(getTaskDetailProjection(TASK_ID)).toMatchObject({
      instruction: detail.instruction,
      name: 'Initial task',
    });

    useTaskStore.getState().internal_dispatchTaskDetail({
      id: TASK_ID,
      type: 'updateTaskDetail',
      value: { name: 'Renamed task' },
    });
    expect(getTaskDetailProjection(TASK_ID)).toMatchObject({
      instruction: detail.instruction,
      name: 'Renamed task',
    });

    useTaskStore.getState().internal_dispatchTaskDetail({
      id: TASK_ID,
      type: 'deleteTaskDetail',
    });
    expect(getTaskDetailProjection(TASK_ID)).toBeUndefined();
  });

  it('keeps detail-only fields when a newer list fragment refreshes the same task', () => {
    const projection = getProjectionStoreState();
    projection.commitTaskDetail(getCacheScope(), detail, 'network', 100);
    projection.commitTaskList(
      getCacheScope(),
      [
        {
          assigneeAgentId: null,
          description: 'List description',
          id: TASK_ID,
          identifier: detail.identifier,
          name: 'List title',
          participants: [],
          status: 'running',
          visibility: 'private',
          workspaceId: null,
        } as unknown as TaskListItem,
      ],
      1,
      { visibility: 'all' },
      200,
    );

    expect(getTaskDetailProjection(TASK_ID)).toMatchObject({
      instruction: detail.instruction,
      name: 'List title',
      status: 'running',
    });
  });
});

describe('Task list query keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(taskService.list).mockResolvedValue({ data: [], total: 0 } as never);
    vi.mocked(taskService.groupList).mockResolvedValue({ data: [] } as never);
    useTaskStore.setState({
      groupListQueryAutomated: undefined,
      isTaskGroupListInit: false,
      isTaskListInit: false,
      listAgentId: undefined,
      listGroupBy: 'status',
      listGroupExcludeStatuses: undefined,
      listQueryAutomated: undefined,
      listQueryStatuses: undefined,
      listQueryVisibility: 'all',
      listVisibility: 'all',
    });
  });

  it('keys and requests assignee groups independently from status groups', async () => {
    renderHook(() =>
      useTaskStore.getState().useFetchTaskGroupList({
        allAgents: true,
        automated: false,
        excludeStatuses: ['completed', 'canceled'],
        groupBy: 'assignee',
      }),
    );

    const groupListCall = vi
      .mocked(useClientDataSWR)
      .mock.calls.find(([key]) => Array.isArray(key) && key[0] === 'task:groupList');
    expect(groupListCall?.[0]).toEqual([
      'task:groupList',
      '__all__',
      'all',
      'assignee',
      'canceled,completed',
      { automated: false },
    ]);
    const fetcher = groupListCall?.[1] as () => unknown;
    await fetcher();
    expect(taskService.groupList).toHaveBeenCalledWith({
      assigneeAgentId: undefined,
      automated: false,
      excludeStatuses: ['completed', 'canceled'],
      groupBy: 'assignee',
      projectId: undefined,
      visibility: undefined,
    });
  });

  it('gates stale kanban data until the group query scope commits after render', () => {
    useTaskStore.setState({
      listAgentId: '__all__',
      listGroupBy: 'status',
      listGroupExcludeStatuses: undefined,
    });
    let groupByObservedDuringRender: string | undefined;

    const { result } = renderHook(() => {
      const swr = useTaskStore
        .getState()
        .useFetchTaskGroupList({ allAgents: true, groupBy: 'assignee' });
      groupByObservedDuringRender = useTaskStore.getState().listGroupBy;
      return swr;
    });

    expect(groupByObservedDuringRender).toBe('status');
    expect(result.current.isQueryScopeCurrent).toBe(false);
    expect(useTaskStore.getState().listGroupBy).toBe('assignee');
  });

  it('passes the automation and status filters to the server and keys the cache by them', async () => {
    renderHook(() =>
      useTaskStore.getState().useFetchTaskList({
        allAgents: true,
        automated: false,
        orderBy: 'updatedAt',
        statuses: ['running', 'backlog'],
        visibility: 'all',
      }),
    );

    const listCall = vi
      .mocked(useClientDataSWR)
      .mock.calls.find(([key]) => Array.isArray(key) && key[0] === 'task:list');
    expect(listCall?.[0]).toEqual([
      'task:list',
      '__all__',
      'all',
      'updatedAt',
      { automated: false, statuses: 'backlog,running' },
    ]);
    const fetcher = listCall?.[1] as (key: unknown[]) => Promise<unknown>;
    await fetcher(['task:list', '__all__', 'all', 'updatedAt', {}]);
    expect(taskService.list).toHaveBeenCalledWith(
      expect.objectContaining({ automated: false, statuses: ['running', 'backlog'] }),
    );
  });

  it('keys and requests the selected scheduled-task page', async () => {
    useTaskStore.getState().useFetchScheduledTaskList({ limit: 50, offset: 50 });

    const scheduledCall = vi
      .mocked(useClientDataSWR)
      .mock.calls.find(([key]) => Array.isArray(key) && key[0] === 'task:scheduledList');
    expect(scheduledCall?.[0]).toEqual([
      'task:scheduledList',
      '__all__',
      'all',
      { limit: 50, offset: 50 },
    ]);
    const fetcher = scheduledCall?.[1] as () => Promise<unknown>;
    await fetcher();
    expect(taskService.list).toHaveBeenCalledWith(
      expect.objectContaining({ automated: true, limit: 50, offset: 50 }),
    );
  });

  it('scopes the scheduled roll-up to one agent and one project', async () => {
    useTaskStore.getState().useFetchScheduledTaskList({ agentId: 'agent-1', limit: 50 });
    useTaskStore.getState().useFetchScheduledTaskList({ limit: 50, projectId: 'project-1' });

    expect(
      vi
        .mocked(useClientDataSWR)
        .mock.calls.map(([key]) => key)
        .filter((key) => Array.isArray(key) && key[0] === 'task:scheduledList'),
    ).toEqual([
      ['task:scheduledList', 'agent-1', 'all', { limit: 50, offset: undefined }],
      ['task:scheduledList', '__project__:project-1', 'all', { limit: 50, offset: undefined }],
    ]);
  });
});
