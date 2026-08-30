import type { ProjectionRef, ProjectionSource } from '../base';
import type { ProjectionKeyOf } from '../runtime';
import { defineProjectionKeySpace } from '../runtime';

export const TASK_GROUP_LIST_INDEX_PREFIX = 'task.groupList:';
export const TASK_LIST_INDEX_PREFIX = 'task.list:';

export const taskIndexKeySpace = defineProjectionKeySpace({
  patterns: [{ prefix: TASK_GROUP_LIST_INDEX_PREFIX }, { prefix: TASK_LIST_INDEX_PREFIX }],
  staticKeys: [],
});

type TaskIndexKey = ProjectionKeyOf<typeof taskIndexKeySpace>;
export type TaskListIndexKey = Extract<TaskIndexKey, `${typeof TASK_LIST_INDEX_PREFIX}${string}`>;
export type TaskGroupListIndexKey = Extract<
  TaskIndexKey,
  `${typeof TASK_GROUP_LIST_INDEX_PREFIX}${string}`
>;

export interface TaskListQuerySignature {
  agentKey?: string;
  visibility: 'all' | 'private' | 'workspace';
}

export interface TaskListIndex {
  key: TaskListIndexKey;
  observedAt: number;
  refs: ProjectionRef<'task'>[];
  signature: TaskListQuerySignature;
  source: ProjectionSource;
  total: number;
}

export interface TaskGroupIndexGroup {
  hasMore: boolean;
  key: string;
  limit: number;
  offset: number;
  refs: ProjectionRef<'task'>[];
  total: number;
}

export interface TaskGroupListIndex {
  groups: TaskGroupIndexGroup[];
  key: TaskGroupListIndexKey;
  observedAt: number;
  signature: TaskListQuerySignature;
  source: ProjectionSource;
}

export type TaskIndexMap = { [K in TaskGroupListIndexKey]: TaskGroupListIndex } & {
  [K in TaskListIndexKey]: TaskListIndex;
};

const taskQueryIdentity = (agentKey: string | undefined, visibility: string): string =>
  `${encodeURIComponent(agentKey ?? '__none__')}:${visibility}`;

export const taskListIndexKey = (
  agentKey: string | undefined,
  visibility: TaskListQuerySignature['visibility'],
): TaskListIndexKey => `${TASK_LIST_INDEX_PREFIX}${taskQueryIdentity(agentKey, visibility)}`;

export const taskGroupListIndexKey = (
  agentKey: string | undefined,
  visibility: TaskListQuerySignature['visibility'],
): TaskGroupListIndexKey =>
  `${TASK_GROUP_LIST_INDEX_PREFIX}${taskQueryIdentity(agentKey, visibility)}`;
