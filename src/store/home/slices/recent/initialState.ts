import type { RecentItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { DocsHomeRow } from './projection';

export { createConversationRecentQueryKey, createRecentQueryKey } from './projection';

/** `${type}:${id}`: ids of different entity types can collide. */
export type RecentEntityRef = `${RecentItem['type']}:${string}`;

export const toRecentEntityRef = (item: Pick<RecentItem, 'id' | 'type'>): RecentEntityRef =>
  `${item.type}:${item.id}`;

export interface RecentState {
  allRecentsDrawerOpen: boolean;
  /** Latest topics per owner, the view of the `conversationRecent` replica. */
  conversationRecentMap: Record<string, RecentItem[]>;
  /** Replica bookkeeping for `conversationRecentMap`. */
  conversationRecentReplica: ReplicaState<RecentItem[]>;
  /** Docs home list per tab, the view of the `docsHomeList` replica. */
  docsHomeMap: Record<string, DocsHomeRow[]>;
  docsHomeReplica: ReplicaState<DocsHomeRow[]>;
  /** Recents per query (`limit:N`), the view of the `recentList` replica. */
  recentListMap: Record<string, RecentItem[]>;
  /** Replica bookkeeping for `recentListMap`. */
  recentListReplica: ReplicaState<RecentItem[]>;
}

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  conversationRecentMap: {},
  conversationRecentReplica: createReplicaState(),
  docsHomeMap: {},
  docsHomeReplica: createReplicaState(),
  recentListMap: {},
  recentListReplica: createReplicaState(),
};
