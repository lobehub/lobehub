import type { TrashCountByType, TrashItem, TrashResourceType } from '@lobechat/types';

import { definePagedReplica, defineReplica } from '@/libs/replica';

import type { TrashListData } from './initialState';

export interface TrashListParams {
  resourceType?: TrashResourceType;
}

/** Entry key of the "everything" filter — not a `TrashResourceType`, so it never collides. */
export const TRASH_ALL_KEY = 'all';

/** Entry key of one recycle-bin filter (`trashListMap[resourceType ?? 'all']`). */
export const trashListKey = (resourceType?: TrashResourceType): string =>
  resourceType ?? TRASH_ALL_KEY;

/**
 * Recycle-bin rows, one local-first entry per type filter (`trashListMap[key]`).
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
  key: ({ resourceType }) => trashListKey(resourceType),
  name: 'trashList',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'cursor',
    // A reload repaints what the first network page would show, not a stale tail.
    persist: { pages: 1 },
  },
  storage: 'indexedDB',
  version: 1,
});

/** Per-type counts (`trashCountMap.all`) that drive the filter chips and empty total. */
export const trashCountResource = defineReplica<Record<string, never>, TrashCountByType>({
  key: () => TRASH_ALL_KEY,
  name: 'trashCount',
  storage: 'indexedDB',
  version: 1,
});
