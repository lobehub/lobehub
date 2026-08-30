'use client';

import type { TaskDetailData, TaskListItem, TaskListQuerySignature } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { useCacheScope } from '@/libs/swr/useCacheScope';

import { useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import {
  taskDetailViewContract,
  taskGroupListViewContract,
  taskListViewContract,
} from './contracts';
import {
  findTaskRecordByIdentity,
  selectTaskDetail,
  selectTaskGroupList,
  selectTaskListIndex,
  selectTaskListItem,
  type TaskGroupListView,
} from './selectors';

export const useTaskDetailProjection = (
  identity: string | undefined,
): TaskDetailData | undefined => {
  useProjectionViewHydration(taskDetailViewContract, { id: identity ?? '' }, Boolean(identity));
  const scope = useCacheScope();
  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    return identity
      ? selectTaskDetail(findTaskRecordByIdentity(projectionScope, identity))
      : undefined;
  }, isEqual);
};

export const useTaskGroupListProjection = (
  signature: TaskListQuerySignature,
  enabled = true,
): TaskGroupListView | undefined => {
  useProjectionViewHydration(taskGroupListViewContract, signature, enabled);
  const scope = useCacheScope();
  return useProjectionStore(
    (state) => (enabled ? selectTaskGroupList(state.scopes[scope], signature) : undefined),
    isEqual,
  );
};

export interface TaskListProjectionState {
  items: TaskListItem[];
  total: number;
}

export const useTaskListProjection = (
  signature: TaskListQuerySignature,
  enabled = true,
): TaskListProjectionState | undefined => {
  useProjectionViewHydration(taskListViewContract, signature, enabled);
  const scope = useCacheScope();
  return useProjectionStore((state) => {
    if (!enabled) return undefined;
    const projectionScope = state.scopes[scope];
    const index = selectTaskListIndex(projectionScope, signature);
    if (!projectionScope || !index) return undefined;
    const items = index.refs.flatMap((ref) => {
      const item = selectTaskListItem(projectionScope, projectionScope.records.task[ref.id]);
      return item ? [item] : [];
    });
    return { items, total: index.total };
  }, isEqual);
};
