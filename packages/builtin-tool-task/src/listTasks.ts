import type { TaskStatus } from '@lobechat/types';

import { UNFINISHED_TASK_STATUSES } from './constants';

export const DEFAULT_LIST_TASK_LIMIT = 20;
const MAX_LIST_TASK_LIMIT = 100;

export interface ListTasksParams {
  assigneeAgentId?: string;
  limit?: number;
  offset?: number;
  parentIdentifier?: string;
  priorities?: number[];
  statuses?: TaskStatus[];
}

export interface TaskListQuery {
  assigneeAgentId?: string;
  limit: number;
  offset: number;
  parentTaskId?: string | null;
  priorities?: number[];
  statuses?: TaskStatus[];
}

export interface TaskListDisplayFilters {
  assigneeAgentId?: string;
  isDefaultScope: boolean;
  isForCurrentAgent?: boolean;
  parentIdentifier?: string;
  priorities?: number[];
  statuses?: TaskStatus[];
}

interface NormalizeListTasksOptions {
  currentAgentId?: string;
  parentTaskId?: string;
}

const hasExplicitFilter = (params: ListTasksParams): boolean =>
  Boolean(
    params.parentIdentifier ||
    params.statuses?.length ||
    params.priorities?.length ||
    params.assigneeAgentId,
  );

/**
 * Normalize tool-facing listTasks params into concrete query args and display filters.
 */
export const normalizeListTasksParams = (
  params: ListTasksParams,
  options: NormalizeListTasksOptions = {},
): {
  displayFilters: TaskListDisplayFilters;
  query: TaskListQuery;
} => {
  const { currentAgentId, parentTaskId } = options;
  const isDefaultScope = !hasExplicitFilter(params);

  const statuses = params.statuses ?? (isDefaultScope ? [...UNFINISHED_TASK_STATUSES] : undefined);
  const assigneeAgentId = params.assigneeAgentId ?? (isDefaultScope ? currentAgentId : undefined);
  const resolvedParentTaskId = parentTaskId ?? (isDefaultScope ? null : undefined);

  return {
    displayFilters: {
      assigneeAgentId,
      isDefaultScope,
      isForCurrentAgent: isDefaultScope && Boolean(currentAgentId),
      parentIdentifier: params.parentIdentifier,
      priorities: params.priorities,
      statuses,
    },
    query: {
      assigneeAgentId,
      limit: Math.min(params.limit ?? DEFAULT_LIST_TASK_LIMIT, MAX_LIST_TASK_LIMIT),
      offset: params.offset ?? 0,
      parentTaskId: resolvedParentTaskId,
      priorities: params.priorities,
      statuses,
    },
  };
};
