'use client';

import type { ProjectionRequestMarker, TaskListQuerySignature } from '@lobechat/types';
import type { Key, SWRConfiguration } from 'swr';

import { type ProjectionQueryResponse, useProjectionRequest } from '../../query/hook';
import {
  taskDetailProjectionQuery,
  taskGroupListProjectionQuery,
  taskListProjectionQuery,
} from './queries';
import type { TaskGroupListView } from './selectors';
import {
  useTaskDetailProjection,
  useTaskGroupListProjection,
  useTaskListProjection,
} from './viewHooks';

interface TaskDetailProjectionRequestOptions extends SWRConfiguration<ProjectionRequestMarker> {
  missing?: 'null' | 'throw';
}

export const useTaskGroupListProjectionRequest = (
  key: Key,
  params: Parameters<typeof taskGroupListProjectionQuery.query>[0],
  enabled: boolean,
  options?: SWRConfiguration<ProjectionRequestMarker>,
): ProjectionQueryResponse<TaskGroupListView> => {
  const signature: TaskListQuerySignature = params.signature;
  const data = useTaskGroupListProjection(signature, enabled);
  const request = useProjectionRequest(
    enabled ? key : null,
    taskGroupListProjectionQuery,
    params,
    options,
  );

  return { ...request, data };
};

export const useTaskDetailProjectionRequest = (
  key: Key,
  taskId: string | undefined,
  options?: TaskDetailProjectionRequestOptions,
) => {
  const { missing = 'throw', ...swrOptions } = options ?? {};
  const data = useTaskDetailProjection(taskId);
  const request = useProjectionRequest(
    taskId ? key : null,
    taskDetailProjectionQuery,
    { missing, taskId: taskId ?? '' },
    swrOptions,
  );

  return { ...request, data };
};

export const useTaskListProjectionRequest = (
  key: Key,
  params: Parameters<typeof taskListProjectionQuery.query>[0],
  enabled: boolean,
  options?: SWRConfiguration<ProjectionRequestMarker>,
) => {
  const data = useTaskListProjection(params.signature, enabled);
  const request = useProjectionRequest(
    enabled ? key : null,
    taskListProjectionQuery,
    params,
    options,
  );

  return { ...request, data };
};
