import type { RecentItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export { createRecentQueryKey } from './projection';

/** `${type}:${id}`: ids of different entity types can collide. */
export type RecentEntityRef = `${RecentItem['type']}:${string}`;

export const toRecentEntityRef = (item: Pick<RecentItem, 'id' | 'type'>): RecentEntityRef =>
  `${item.type}:${item.id}`;

export interface RecentState {
  allRecentsDrawerOpen: boolean;
  /** Recents per query (`limit:N`), the view of the `recentList` replica. */
  recentListMap: Record<string, RecentItem[]>;
  /** Replica bookkeeping for `recentListMap`. */
  recentListReplica: ReplicaState<RecentItem[]>;
}

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  recentListMap: {},
  recentListReplica: createReplicaState(),
};
