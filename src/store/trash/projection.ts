import type {
  TrashCountByType,
  TrashItem,
  TrashProjectFilter,
  TrashVisibility,
} from '@lobechat/types';

import { definePagedReplica, defineReplica } from '@/libs/replica';
import type { TrashCountFilter, TrashViewFilter } from '@/services/trash';

import type { TrashListData } from './initialState';

export type TrashListParams = TrashViewFilter;

export type TrashCountParams = TrashCountFilter;

/** Key segment of the "everything" filter — not a type or a project id, so it never collides. */
export const TRASH_ALL_KEY = 'all';

/** Key segment of a project filter: every project, no project, or one project. */
export const trashProjectKey = (projectId?: TrashProjectFilter): string =>
  projectId === undefined ? TRASH_ALL_KEY : projectId === null ? 'none' : `project:${projectId}`;

/** Key segment of a workspace bin's side; a personal bin has none. */
const trashSideKey = (visibility?: TrashVisibility): string => visibility ?? TRASH_ALL_KEY;

/**
 * Entry key of one recycle-bin view (`trashListMap[key]`): every dimension the
 * server filters on. The scope (user + workspace) partitions the replica
 * itself, and the acting member is the scope's user.
 */
export const trashListKey = ({
  projectId,
  resourceType,
  visibility,
}: TrashListParams = {}): string =>
  `${trashSideKey(visibility)}|${resourceType ?? TRASH_ALL_KEY}|${trashProjectKey(projectId)}`;

/** Entry key of the per-type counts of one side and project filter (`trashCountMap[key]`). */
export const trashCountKey = ({ projectId, visibility }: TrashCountParams = {}): string =>
  `${trashSideKey(visibility)}|${trashProjectKey(projectId)}`;

/**
 * Recycle-bin rows, one local-first entry per view (`trashListMap[key]`).
 *
 * The server pages by an opaque cursor over `(deleted_at, id)`, newest first,
 * so the view walks `nextCursor` forward. Rows are read through
 * `trashSelectors`, never from the sync hook.
 */
export const trashListResource = definePagedReplica<
  TrashListParams,
  TrashItem,
  string,
  TrashListData
>({
  key: trashListKey,
  name: 'trashList',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'cursor',
    // A reload repaints what the first network page would show, not a stale tail.
    persist: { pages: 1 },
  },
  storage: 'indexedDB',
  // v3: entries are keyed by side, type and project.
  version: 3,
});

/** Per-type counts of one side and project filter: the type chips, the totals and the empty-trash scope. */
export const trashCountResource = defineReplica<TrashCountParams, TrashCountByType>({
  key: trashCountKey,
  name: 'trashCount',
  storage: 'indexedDB',
  // v3: entries are keyed by side and project.
  version: 3,
});
