import type { ClientDataEntityRecord } from '@lobechat/types';

import { isEntityFragment, isObject, isTimestamp } from '../core/validation';

const ENTITY_KINDS = new Set(['agent', 'brief', 'chatGroup', 'task', 'topic']);
const ENTITY_FRAGMENTS: Record<string, ReadonlySet<string>> = {
  agent: new Set(['access', 'identity', 'profile', 'routing', 'runtime']),
  brief: new Set(['actions', 'content', 'readState', 'relations', 'resolution']),
  chatGroup: new Set(['access', 'identity']),
  task: new Set(['assignment', 'description', 'display', 'identity', 'lifecycle']),
  topic: new Set([
    'activity',
    'creation',
    'display',
    'navigation',
    'preview',
    'routing',
    'runTiming',
    'status',
  ]),
};

export const isClientDataEntityRecord = (value: unknown): value is ClientDataEntityRecord => {
  if (
    !isObject(value) ||
    typeof value.id !== 'string' ||
    typeof value.kind !== 'string' ||
    !ENTITY_KINDS.has(value.kind) ||
    !isObject(value.fragments) ||
    (value.tombstoneAt !== undefined && !isTimestamp(value.tombstoneAt))
  ) {
    return false;
  }

  const allowedFragments = ENTITY_FRAGMENTS[value.kind];
  return Object.entries(value.fragments).every(
    ([name, fragment]) => allowedFragments.has(name) && isEntityFragment(fragment),
  );
};
