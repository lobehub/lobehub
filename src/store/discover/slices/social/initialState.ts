import { createReplicaState, type ReplicaState } from '@/libs/replica';
import {
  type FavoriteAgentItem,
  type FavoritePluginItem,
  type FollowCounts,
  type FollowStatus,
  type FollowUserItem,
  type PaginatedResponse,
} from '@/services/social';

/**
 * Replica views of the social reads, each beside its bookkeeping slot. The
 * views are plain records keyed by the entry key of the matching resource
 * (`projection.ts`); components read them through `socialSelectors`, never
 * through the fetch hook.
 */
export interface SocialSliceState {
  /** A user's favorited agents per query (`socialListKey`). */
  favoriteAgentsMap: Record<string, PaginatedResponse<FavoriteAgentItem>>;
  /** Replica bookkeeping of `favoriteAgentsMap`. */
  favoriteAgentsReplica: ReplicaState<PaginatedResponse<FavoriteAgentItem>>;
  /** A user's favorited plugins per query (`socialListKey`). */
  favoritePluginsMap: Record<string, PaginatedResponse<FavoritePluginItem>>;
  /** Replica bookkeeping of `favoritePluginsMap`. */
  favoritePluginsReplica: ReplicaState<PaginatedResponse<FavoritePluginItem>>;
  /** Target user's follower / following counts (`socialUserKey`). */
  followCountsMap: Record<string, FollowCounts>;
  /** Replica bookkeeping of `followCountsMap`. */
  followCountsReplica: ReplicaState<FollowCounts>;
  /** A user's followers per query (`socialListKey`). */
  followersMap: Record<string, PaginatedResponse<FollowUserItem>>;
  /** Replica bookkeeping of `followersMap`. */
  followersReplica: ReplicaState<PaginatedResponse<FollowUserItem>>;
  /** A user's following per query (`socialListKey`). */
  followingMap: Record<string, PaginatedResponse<FollowUserItem>>;
  /** Replica bookkeeping of `followingMap`. */
  followingReplica: ReplicaState<PaginatedResponse<FollowUserItem>>;
  /** Whether the viewer follows the target user (`socialUserKey`). */
  followStatusMap: Record<string, FollowStatus>;
  /** Replica bookkeeping of `followStatusMap`. */
  followStatusReplica: ReplicaState<FollowStatus>;
}

export const initialSocialSliceState: SocialSliceState = {
  favoriteAgentsMap: {},
  favoriteAgentsReplica: createReplicaState(),
  favoritePluginsMap: {},
  favoritePluginsReplica: createReplicaState(),
  followCountsMap: {},
  followCountsReplica: createReplicaState(),
  followStatusMap: {},
  followStatusReplica: createReplicaState(),
  followersMap: {},
  followersReplica: createReplicaState(),
  followingMap: {},
  followingReplica: createReplicaState(),
};
