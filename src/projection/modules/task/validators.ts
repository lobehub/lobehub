import type { TaskGroupListIndex, TaskListIndex } from '@lobechat/types';
import { TASK_LIST_INDEX_PREFIX, taskIndexKeySpace } from '@lobechat/types';

import { hasObservation, isObject, isProjectionRef } from '../../core/validation';

const isSignature = (value: unknown): boolean =>
  isObject(value) &&
  (value.agentKey === undefined || typeof value.agentKey === 'string') &&
  (value.visibility === 'all' ||
    value.visibility === 'private' ||
    value.visibility === 'workspace');

export const isTaskIndex = (value: unknown): value is TaskGroupListIndex | TaskListIndex => {
  if (!isObject(value) || typeof value.key !== 'string' || !hasObservation(value)) return false;
  if (!taskIndexKeySpace.isKey(value.key)) return false;
  if (!isSignature(value.signature)) return false;

  if (value.key.startsWith(TASK_LIST_INDEX_PREFIX)) {
    return (
      Array.isArray(value.refs) &&
      value.refs.every((ref) => isProjectionRef(ref, 'task')) &&
      typeof value.total === 'number' &&
      Number.isInteger(value.total) &&
      value.total >= 0
    );
  }

  if (!Array.isArray(value.groups)) return false;
  return value.groups.every(
    (group) =>
      isObject(group) &&
      typeof group.key === 'string' &&
      typeof group.hasMore === 'boolean' &&
      typeof group.limit === 'number' &&
      typeof group.offset === 'number' &&
      typeof group.total === 'number' &&
      Array.isArray(group.refs) &&
      group.refs.every((ref) => isProjectionRef(ref, 'task')),
  );
};
