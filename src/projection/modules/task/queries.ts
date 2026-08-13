import type { TaskListQuerySignature } from '@lobechat/types';

import { taskService } from '@/services/task';

import { defineProjectionQuery, executeProjectionQuery } from '../../query/runtime';
import { getProjectionStoreState } from '../../store';
import { findTaskRecordByIdentity, selectTaskDetail } from './selectors';

export interface TaskDetailQueryParams {
  missing?: 'null' | 'throw';
  taskId: string;
}

type TaskDetailQueryResponse = Awaited<ReturnType<typeof taskService.getDetail>>;

export const taskDetailProjectionQuery = defineProjectionQuery<
  TaskDetailQueryParams,
  TaskDetailQueryResponse
>({
  project: (result, { observedAt, params, scope }) => {
    if (result.data) {
      getProjectionStoreState().commitTaskDetail(scope, result.data, 'network', observedAt);
      return;
    }

    getProjectionStoreState().deleteTaskProjection(scope, params.taskId, observedAt);
    if (params.missing === 'throw') {
      const notFound = new Error(`Task not found: ${params.taskId}`) as Error & { code?: string };
      notFound.code = 'TASK_NOT_FOUND';
      throw notFound;
    }
  },
  query: ({ taskId }) => taskService.getDetail(taskId),
});

export const loadTaskDetailProjection = async (
  taskId: string,
  scope: string,
  missing: TaskDetailQueryParams['missing'] = 'null',
) => {
  const { response } = await executeProjectionQuery(
    taskDetailProjectionQuery,
    { missing, taskId },
    scope,
  );
  const identity = response.data ? (response.data.id ?? response.data.identifier) : taskId;
  const record = findTaskRecordByIdentity(getProjectionStoreState().scopes[scope], identity);
  return selectTaskDetail(record);
};

export interface TaskListQueryParams {
  request: Parameters<typeof taskService.list>[0];
  signature: TaskListQuerySignature;
}

type TaskListQueryResponse = Awaited<ReturnType<typeof taskService.list>>;

export const taskListProjectionQuery = defineProjectionQuery<
  TaskListQueryParams,
  TaskListQueryResponse
>({
  project: (result, { observedAt, params, scope }) => {
    getProjectionStoreState().commitTaskList(
      scope,
      result.data,
      result.total,
      params.signature,
      observedAt,
    );
  },
  query: ({ request }) => taskService.list(request),
});

export interface TaskGroupListQueryParams {
  request: Parameters<typeof taskService.groupList>[0];
  signature: TaskListQuerySignature;
}

type TaskGroupListQueryResponse = Awaited<ReturnType<typeof taskService.groupList>>;

export const taskGroupListProjectionQuery = defineProjectionQuery<
  TaskGroupListQueryParams,
  TaskGroupListQueryResponse
>({
  project: (result, { observedAt, params, scope }) => {
    getProjectionStoreState().commitTaskGroupList(scope, result.data, params.signature, observedAt);
  },
  query: ({ request }) => taskService.groupList(request),
});
