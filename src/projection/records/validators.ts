import type { ProjectionRecord } from '@lobechat/types';

import { isObject, isProjectionFragment, isTimestamp } from '../core/validation';

const ENTITY_KINDS = new Set(['agent', 'brief', 'chatGroup', 'task', 'topic']);
const ENTITY_FRAGMENTS: Record<string, ReadonlySet<string>> = {
  agent: new Set([
    'access',
    'configuration',
    'identity',
    'knowledge',
    'lifecycle',
    'profile',
    'routing',
    'runtime',
  ]),
  brief: new Set(['actions', 'content', 'readState', 'relations', 'resolution']),
  chatGroup: new Set(['access', 'configuration', 'identity', 'lifecycle', 'membership']),
  task: new Set([
    'assignment',
    'description',
    'detail',
    'display',
    'identity',
    'lifecycle',
    'participants',
    'row',
  ]),
  topic: new Set([
    'activity',
    'analytics',
    'completion',
    'creation',
    'details',
    'display',
    'generation',
    'marking',
    'navigation',
    'ordering',
    'ownership',
    'preview',
    'routing',
    'runTiming',
    'status',
    'summary',
    'triggerInfo',
  ]),
};

export const isProjectionRecord = (value: unknown): value is ProjectionRecord => {
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
    ([name, fragment]) => allowedFragments.has(name) && isProjectionFragment(fragment),
  );
};
