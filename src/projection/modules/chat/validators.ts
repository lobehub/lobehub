import type { ChatTopicsIndex } from '@lobechat/types';
import { chatIndexKeySpace } from '@lobechat/types';

import { hasObservation, isObject, isProjectionRef } from '../../core/validation';

const isStringArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isSignature = (value: unknown): boolean =>
  isObject(value) &&
  (value.excludeStatuses === undefined || isStringArray(value.excludeStatuses)) &&
  (value.excludeTriggers === undefined || isStringArray(value.excludeTriggers)) &&
  (value.isInbox === undefined || typeof value.isInbox === 'boolean') &&
  (value.sortBy === undefined || typeof value.sortBy === 'string') &&
  (value.withDetails === undefined || typeof value.withDetails === 'boolean');

export const isChatIndex = (value: unknown): value is ChatTopicsIndex => {
  if (!isObject(value)) return false;
  const key = value.key;
  if (typeof key !== 'string' || !hasObservation(value)) return false;
  if (!chatIndexKeySpace.isKey(key)) return false;

  return (
    Array.isArray(value.refs) &&
    value.refs.every((ref) => isProjectionRef(ref, 'topic')) &&
    typeof value.total === 'number' &&
    Number.isInteger(value.total) &&
    value.total >= 0 &&
    typeof value.persistRefLimit === 'number' &&
    Number.isInteger(value.persistRefLimit) &&
    value.persistRefLimit > 0 &&
    isSignature(value.signature)
  );
};
