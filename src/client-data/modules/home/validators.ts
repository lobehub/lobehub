import type { HomeIndex, HomeSnapshot } from '@lobechat/types';

import { hasObservation, isEntityRef, isObject } from '../../core/validation';

const INDEX_KEYS = new Set([
  'home.inboxTopics',
  'home.recentTopics',
  'home.sidebar',
  'home.tasks',
  'home.unresolvedBriefs',
]);

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

export const isHomeIndex = (value: unknown): value is HomeIndex => {
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

export const isHomeSnapshot = (value: unknown): value is HomeSnapshot =>
  isObject(value) &&
  value.key === 'home.dailyBrief' &&
  hasObservation(value) &&
  isObject(value.data) &&
  Array.isArray(value.data.pairs) &&
  value.data.pairs.every(
    (pair) => isObject(pair) && typeof pair.hint === 'string' && typeof pair.welcome === 'string',
  );
