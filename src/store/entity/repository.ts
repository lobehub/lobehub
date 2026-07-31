import type {
  EntitySource,
  HomeEntityIndex,
  HomeEntityRecord,
  HomeEntitySnapshot,
} from '@lobechat/types';

import { createEntityDataRepository } from '@/libs/entityData';

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

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
    'homePreview',
    'recentNavigation',
    'routing',
    'runTiming',
    'status',
  ]),
};
const INDEX_KEYS = new Set([
  'home.inboxTopics',
  'home.recentTopics',
  'home.sidebar',
  'home.tasks',
  'home.unresolvedBriefs',
]);

const isEntitySource = (value: unknown): value is EntitySource =>
  value === 'mutation' || value === 'network' || value === 'realtime';

const hasObservation = (value: Record<string, unknown>): boolean =>
  isTimestamp(value.observedAt) && isEntitySource(value.source);

const isEntityFragment = (value: unknown): boolean =>
  isObject(value) && hasObservation(value) && isObject(value.data);

const isEntityRef = (value: unknown, kind: string): boolean =>
  isObject(value) && value.kind === kind && typeof value.id === 'string';

const isSidebarRef = (value: unknown): boolean =>
  isObject(value) &&
  (value.kind === 'agent' || value.kind === 'chatGroup') &&
  typeof value.id === 'string' &&
  typeof value.pinned === 'boolean' &&
  value.updatedAt instanceof Date &&
  Number.isFinite(value.updatedAt.getTime());

const isSidebarGroup = (value: unknown): boolean =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  Array.isArray(value.items) &&
  value.items.every(isSidebarRef);

export const isHomeEntityRecord = (value: unknown): value is HomeEntityRecord => {
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

export const isHomeEntityIndex = (value: unknown): value is HomeEntityIndex => {
  if (
    !isObject(value) ||
    typeof value.key !== 'string' ||
    !INDEX_KEYS.has(value.key) ||
    !hasObservation(value)
  ) {
    return false;
  }

  if (value.key === 'home.sidebar') {
    return (
      Array.isArray(value.pinned) &&
      value.pinned.every(isSidebarRef) &&
      Array.isArray(value.groups) &&
      value.groups.every(isSidebarGroup) &&
      Array.isArray(value.ungrouped) &&
      value.ungrouped.every(isSidebarRef) &&
      Array.isArray(value.privatePinned) &&
      value.privatePinned.every(isSidebarRef) &&
      Array.isArray(value.privateGroups) &&
      value.privateGroups.every(isSidebarGroup) &&
      Array.isArray(value.privateUngrouped) &&
      value.privateUngrouped.every(isSidebarRef)
    );
  }

  if (!Array.isArray(value.refs)) return false;
  const kind =
    value.key === 'home.tasks' ? 'task' : value.key === 'home.unresolvedBriefs' ? 'brief' : 'topic';
  if (!value.refs.every((ref) => isEntityRef(ref, kind))) return false;
  if (value.key === 'home.tasks') {
    return typeof value.total === 'number' && Number.isInteger(value.total) && value.total >= 0;
  }
  if (value.key === 'home.recentTopics') {
    return (
      typeof value.limit === 'number' &&
      Number.isInteger(value.limit) &&
      value.limit >= 0 &&
      (value.view === 'mine' || value.view === 'team')
    );
  }
  return true;
};

export const isHomeEntitySnapshot = (value: unknown): value is HomeEntitySnapshot =>
  isObject(value) &&
  value.key === 'home.dailyBrief' &&
  hasObservation(value) &&
  isObject(value.data) &&
  Array.isArray(value.data.pairs) &&
  value.data.pairs.every(
    (pair) => isObject(pair) && typeof pair.hint === 'string' && typeof pair.welcome === 'string',
  );

export const homeEntityRepository = createEntityDataRepository<
  HomeEntityRecord,
  HomeEntityIndex,
  HomeEntitySnapshot
>({
  isEntity: isHomeEntityRecord,
  isIndex: isHomeEntityIndex,
  isSnapshot: isHomeEntitySnapshot,
});
