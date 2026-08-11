import type { ProjectionRef, ProjectionSource } from '../base';

export type TaskListIndexKey = `task.list:${string}`;
export type TaskGroupListIndexKey = `task.groupList:${string}`;

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
): TaskListIndexKey => `task.list:${taskQueryIdentity(agentKey, visibility)}`;

export const taskGroupListIndexKey = (
  agentKey: string | undefined,
  visibility: TaskListQuerySignature['visibility'],
): TaskGroupListIndexKey => `task.groupList:${taskQueryIdentity(agentKey, visibility)}`;
