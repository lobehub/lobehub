import type { RecentItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { RecentFileCard, RecentPageCard } from './projection';

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
  /** Resource home "Recent files" per visibility, the view of the `resourceRecentFiles` replica. */
  resourceRecentFilesMap: Record<string, RecentFileCard[]>;
  resourceRecentFilesReplica: ReplicaState<RecentFileCard[]>;
  /** Resource home "Recent pages" per visibility, the view of the `resourceRecentPages` replica. */
  resourceRecentPagesMap: Record<string, RecentPageCard[]>;
  resourceRecentPagesReplica: ReplicaState<RecentPageCard[]>;
}

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  recentListMap: {},
  recentListReplica: createReplicaState(),
  resourceRecentFilesMap: {},
  resourceRecentFilesReplica: createReplicaState(),
  resourceRecentPagesMap: {},
  resourceRecentPagesReplica: createReplicaState(),
};
