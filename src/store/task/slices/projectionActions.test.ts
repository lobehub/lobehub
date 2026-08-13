import type { TaskDetailData, TaskListItem } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState, useProjectionStore } from '@/projection';
import { getTaskDetailProjection } from '@/projection/modules/task/read';

import { useTaskStore } from '../store';

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
