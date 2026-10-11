import type { RecentItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

export interface RecentListParams {
  limit: number;
  /**
   * Entity types to list; omitted reads every type (the "all recents" drawer).
   * The sidebar carries its own selection so its filter can narrow the feed
   * without the drawer following along.
   */
  types?: readonly RecentItem['type'][];
}

/** Entry key of one recents query (`recentListMap[limit:N]`). */
export const createRecentQueryKey = (limit: number): string => `limit:${limit}`;

/**
 * Recent documents / tasks / topics, one entry per requested limit (the sidebar
 * asks for `pageSize + 1`, the drawer for 50). localStorage keeps the first
 * frame of the home sidebar instant.
 */
export const recentListResource = defineReplica<RecentListParams, RecentItem[]>({
  key: ({ limit }) => createRecentQueryKey(limit),
  name: 'recentList',
  // The type filter changes the rows without changing the entry: both
  // selections share `limit:N` in memory (the newest fetch paints it), while
  // each keeps its own persisted row, so a filter change never hydrates the
  // other selection's rows onto the first frame.
  query: ({ limit, types }) => ({ limit, types }),
  storage: 'localStorage',
  version: 2,
});
