'use client';

import type { TaskDetailData } from '@lobechat/types';

import {
  useTaskDetailProjection,
  useTaskGroupListProjection,
  useTaskListProjection,
} from '@/projection/modules/task/viewHooks';

import { useTaskStore } from './store';

type EqualityFn<T> = (left: T, right: T) => boolean;

export const useActiveTaskDetailProjection = <Selected>(
  selector: (detail: TaskDetailData | undefined) => Selected,
  _equalityFn?: EqualityFn<Selected>,
): Selected => {
  const activeTaskId = useTaskStore((state) => state.activeTaskId);
  return selector(useTaskDetailProjection(activeTaskId));
};

export const useSelectedTaskListProjection = () => {
  const [agentKey, visibility] = useTaskStore((state) => [
    state.listAgentId,
    state.listQueryVisibility,
  ]);
  return useTaskListProjection({ agentKey, visibility }, Boolean(agentKey));
};

export const useSelectedTaskGroupListProjection = () => {
  const [agentKey, visibility] = useTaskStore((state) => [state.listAgentId, state.listVisibility]);
  return useTaskGroupListProjection({ agentKey, visibility }, Boolean(agentKey));
};
