'use client';

import type { TaskDetailData, TaskListQuerySignature } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { useCacheScope } from '@/libs/swr/useCacheScope';

import { useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import { taskDetailViewContract, taskGroupListViewContract } from './contracts';
import {
  findTaskRecordByIdentity,
  selectTaskDetail,
  selectTaskGroupList,
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
): TaskGroupListView | undefined => {
  useProjectionViewHydration(taskGroupListViewContract, signature);
  const scope = useCacheScope();
  return useProjectionStore(
    (state) => selectTaskGroupList(state.scopes[scope], signature),
    isEqual,
  );
};
