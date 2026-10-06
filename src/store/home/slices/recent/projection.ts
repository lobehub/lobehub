import type { RecentItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

export interface RecentListParams {
  limit: number;
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
  storage: 'localStorage',
  version: 1,
});
