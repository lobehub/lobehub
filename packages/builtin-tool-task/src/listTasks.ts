import type { TaskStatus } from '@lobechat/types';

import { UNFINISHED_TASK_STATUSES } from './constants';

export const DEFAULT_LIST_TASK_LIMIT = 20;
const MAX_LIST_TASK_LIMIT = 100;

export interface ListTasksParams {
  assigneeAgentId?: string;
  /** Label (or label group) names; a task matches when it carries any of them. */
  labels?: string[];
  limit?: number;
  offset?: number;
  parentIdentifier?: string;
  priorities?: number[];
  statuses?: TaskStatus[];
}

export interface TaskListQuery {
  assigneeAgentId?: string;
  /** Set by the runtime once `labels` are resolved to ids. */
  filter?: { label?: { operator: 'is'; values: string[] } };
  limit: number;
  offset: number;
  parentIdentifier?: string;
  parentTaskId?: string | null;
  priorities?: number[];
  statuses?: TaskStatus[];
}

export interface TaskListDisplayFilters {
  assigneeAgentId?: string;
  isDefaultScope: boolean;
  isForAllAgents?: boolean;
  isForCurrentAgent?: boolean;
  labels?: string[];
  parentIdentifier?: string;
  priorities?: number[];
  statuses?: TaskStatus[];
}

interface NormalizeListTasksOptions {
  currentAgentId?: string;
  defaultScope?: 'allAgents' | 'currentAgent';
}

export const normalizeOptionalFilterValues = <T>(values?: T[]) =>
  values?.length ? values : undefined;

/**
 * Reject a blank `parentIdentifier` before it reaches the list query.
 *
 * The task list API rejects empty and whitespace-only parents with a raw zod
 * `too_small` issue, which models misread and retry with the same blank value
 * (lobehub/lobehub#23977 saw 49 identical calls in one topic). The value stays
 * an error rather than being treated as "no filter": the caller must learn to
 * omit the field, so the message names that exact correction.
 *
 * @returns The model-facing error message, or `undefined` when params are valid.
 */
export const validateListTasksParams = (params: ListTasksParams): string | undefined => {
  const { parentIdentifier } = params as { parentIdentifier?: unknown };
  if (parentIdentifier === undefined) return;
  if (typeof parentIdentifier === 'string' && parentIdentifier.trim()) return;

  return `Invalid parentIdentifier ${JSON.stringify(parentIdentifier)}: it must be a task identifier or id such as "T-1". To list tasks without a parent filter, omit parentIdentifier entirely instead of passing an empty value, then retry.`;
};

const hasExplicitFilter = (params: ListTasksParams): boolean =>
  Boolean(
    params.parentIdentifier ||
    params.statuses?.length ||
    params.priorities?.length ||
    params.labels?.length ||
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
  const { currentAgentId, defaultScope = 'currentAgent' } = options;
  const isDefaultScope = !hasExplicitFilter(params);
  const priorities = normalizeOptionalFilterValues(params.priorities);
  const statuses =
    normalizeOptionalFilterValues(params.statuses) ??
    (isDefaultScope ? [...UNFINISHED_TASK_STATUSES] : undefined);

  const shouldUseCurrentAgent = isDefaultScope && defaultScope === 'currentAgent';
  const assigneeAgentId =
    params.assigneeAgentId ?? (shouldUseCurrentAgent ? currentAgentId : undefined);

  return {
    displayFilters: {
      assigneeAgentId,
      isDefaultScope,
      isForAllAgents: isDefaultScope && defaultScope === 'allAgents',
      isForCurrentAgent: shouldUseCurrentAgent && Boolean(currentAgentId),
      labels: normalizeOptionalFilterValues(params.labels),
      parentIdentifier: params.parentIdentifier,
      priorities,
      statuses,
    },
    query: {
      assigneeAgentId,
      limit: Math.min(params.limit ?? DEFAULT_LIST_TASK_LIMIT, MAX_LIST_TASK_LIMIT),
      offset: params.offset ?? 0,
      parentIdentifier: params.parentIdentifier,
      parentTaskId: isDefaultScope ? null : undefined,
      priorities,
      statuses,
    },
  };
};
