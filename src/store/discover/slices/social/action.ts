import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import {
  type FavoriteAgentItem,
  type FavoritePluginItem,
  type FollowCounts,
  type FollowStatus,
  type FollowUserItem,
  type PaginatedResponse,
  type SocialTargetType,
} from '@/services/social';
import { socialService } from '@/services/social';
import { type DiscoverStore } from '@/store/discover';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  favoriteAgentsResource,
  favoritePluginsResource,
  followCountsResource,
  followersResource,
  followingResource,
  followStatusResource,
  socialListKey,
  type SocialListParams,
  socialUserKey,
  type SocialUserParams,
} from './projection';

const n = setNamespace('discover/social');

/**
 * Sync flags of a social read, plus the aliases the old SWR hooks returned
 * (`isLoading` / `mutate`) so a call site only has to move its `data` read to
 * the matching `socialSelectors` entry.
 */
export interface SocialSyncResult extends ReplicaSyncResult {
  /** A request is in flight and this entry has no value to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the value with `socialSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

type Setter = StoreSetter<DiscoverStore>;

/** The follower-count delta a viewer's follow toggle applies to the target. */
const optimisticFollowCounts =
  (isFollowing: boolean) =>
  (current: FollowCounts): FollowCounts => ({
    followersCount: isFollowing
      ? current.followersCount + 1
      : Math.max(0, current.followersCount - 1),
    followingCount: current.followingCount,
  });

/** Normalized params of a `socialUserKey` read (status / counts). */
const userParams = (userId: number): SocialUserParams => ({ userId });

/** Normalized params of a `socialListKey` read (followers / following / favorites). */
const listParams = (
  userId: number,
  params?: { page?: number; pageSize?: number },
): SocialListParams => ({ page: params?.page, pageSize: params?.pageSize, userId });

/** A disabled hook never loads; a settled entry with a value never flashes. */
const toSyncResult = (
  sync: ReplicaSyncResult,
  queryKey: string,
  hasValue: boolean,
  active: boolean,
): SocialSyncResult => ({
  ...sync,
  isLoading: active && !hasValue && (!sync.isHydrated || sync.isValidating),
  mutate: sync.revalidate,
  queryKey: active ? queryKey : undefined,
});

export const createSocialSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new SocialActionImpl(set, get, _api);

export class SocialActionImpl {
  readonly #favoriteAgents;
  readonly #favoritePlugins;
  readonly #followCounts;
  readonly #followStatus;
  readonly #followers;
  readonly #following;
  readonly #get: () => DiscoverStore;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#followStatus = createReplicaSlice(followStatusResource, {
      actionPrefix: n('followStatus'),
      get,
      set,
      stateKey: 'followStatusReplica',
      view: recordLens<DiscoverStore, FollowStatus>('followStatusMap'),
    });
    this.#followCounts = createReplicaSlice(followCountsResource, {
      actionPrefix: n('followCounts'),
      get,
      set,
      stateKey: 'followCountsReplica',
      view: recordLens<DiscoverStore, FollowCounts>('followCountsMap'),
    });
    this.#followers = createReplicaSlice(followersResource, {
      actionPrefix: n('followers'),
      get,
      set,
      stateKey: 'followersReplica',
      view: recordLens<DiscoverStore, PaginatedResponse<FollowUserItem>>('followersMap'),
    });
    this.#following = createReplicaSlice(followingResource, {
      actionPrefix: n('following'),
      get,
      set,
      stateKey: 'followingReplica',
      view: recordLens<DiscoverStore, PaginatedResponse<FollowUserItem>>('followingMap'),
    });
    this.#favoriteAgents = createReplicaSlice(favoriteAgentsResource, {
      actionPrefix: n('favoriteAgents'),
      get,
      set,
      stateKey: 'favoriteAgentsReplica',
      view: recordLens<DiscoverStore, PaginatedResponse<FavoriteAgentItem>>('favoriteAgentsMap'),
    });
    this.#favoritePlugins = createReplicaSlice(favoritePluginsResource, {
      actionPrefix: n('favoritePlugins'),
      get,
      set,
      stateKey: 'favoritePluginsReplica',
      view: recordLens<DiscoverStore, PaginatedResponse<FavoritePluginItem>>('favoritePluginsMap'),
    });
  }

  /**
   * Whether the viewer follows the target user. Read it with
   * `socialSelectors.followStatus(queryKey)`; `undefined` while unloaded.
   */
  useFollowStatus = (userId?: number): SocialSyncResult => {
    const active = typeof userId === 'number';
    const params = userParams(userId ?? 0);
    const queryKey = socialUserKey(params);
    const sync = this.#followStatus.useSync(active ? params : null, { enabled: active });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().followStatusMap[queryKey] !== undefined,
      active,
    );
  };

  /**
   * The target user's follower / following counts. Read them with
   * `socialSelectors.followCounts(queryKey)`.
   */
  useFollowCounts = (userId?: number): SocialSyncResult => {
    const active = typeof userId === 'number';
    const params = userParams(userId ?? 0);
    const queryKey = socialUserKey(params);
    const sync = this.#followCounts.useSync(active ? params : null, { enabled: active });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().followCountsMap[queryKey] !== undefined,
      active,
    );
  };

  /** A user's followers page. Read it with `socialSelectors.followers(queryKey)`. */
  useFollowers = (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ): SocialSyncResult => {
    const active = typeof userId === 'number';
    const normalized = listParams(userId ?? 0, params);
    const queryKey = socialListKey(normalized);
    const sync = this.#followers.useSync(active ? normalized : null, { enabled: active });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().followersMap[queryKey] !== undefined,
      active,
    );
  };

  /** A user's following page. Read it with `socialSelectors.following(queryKey)`. */
  useFollowing = (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ): SocialSyncResult => {
    const active = typeof userId === 'number';
    const normalized = listParams(userId ?? 0, params);
    const queryKey = socialListKey(normalized);
    const sync = this.#following.useSync(active ? normalized : null, { enabled: active });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().followingMap[queryKey] !== undefined,
      active,
    );
  };

  /** A user's favorited agents page. Read it with `socialSelectors.favoriteAgents(queryKey)`. */
  useFavoriteAgents = (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ): SocialSyncResult => {
    const active = typeof userId === 'number';
    const normalized = listParams(userId ?? 0, params);
    const queryKey = socialListKey(normalized);
    const sync = this.#favoriteAgents.useSync(active ? normalized : null, { enabled: active });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().favoriteAgentsMap[queryKey] !== undefined,
      active,
    );
  };

  /** A user's favorited plugins page. Read it with `socialSelectors.favoritePlugins(queryKey)`. */
  useFavoritePlugins = (
    userId: number | undefined,
    params?: { page?: number; pageSize?: number },
  ): SocialSyncResult => {
    const active = typeof userId === 'number';
    const normalized = listParams(userId ?? 0, params);
    const queryKey = socialListKey(normalized);
    const sync = this.#favoritePlugins.useSync(active ? normalized : null, { enabled: active });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().favoritePluginsMap[queryKey] !== undefined,
      active,
    );
  };

  /** Refresh every loaded favorites page after a favorite mutation. */
  #refreshFavorites = async (): Promise<void> => {
    await Promise.all([this.#favoriteAgents.revalidate(), this.#favoritePlugins.revalidate()]);
  };

  addFavorite = async (targetType: SocialTargetType, targetId: number): Promise<void> => {
    await socialService.addFavorite(targetType, targetId);
    await this.#refreshFavorites();
  };

  removeFavorite = async (targetType: SocialTargetType, targetId: number): Promise<void> => {
    await socialService.removeFavorite(targetType, targetId);
    await this.#refreshFavorites();
  };

  /**
   * One follow toggle: optimistically flip the status and shift the target's
   * follower count, then confirm (or roll back) once the server answers. The
   * follower / following lists are refreshed afterwards, because the toggle
   * changes lists the viewer may have loaded for other profiles.
   */
  #setFollowing = async (
    followingId: number,
    isFollowing: boolean,
    run: () => Promise<void>,
  ): Promise<void> => {
    const key = socialUserKey({ userId: followingId });
    const status = this.#followStatus.beginOptimistic(key, (current) => ({
      ...current,
      isFollowing,
      isMutual: false,
    }));
    const counts = this.#followCounts.beginOptimistic(key, optimisticFollowCounts(isFollowing));

    try {
      await run();
      status.commit();
      counts.commit();
    } catch (error) {
      status.rollback();
      counts.rollback();
      throw error;
    }

    await Promise.all([this.#followers.revalidate(), this.#following.revalidate()]);
  };

  follow = (followingId: number): Promise<void> =>
    this.#setFollowing(followingId, true, () => socialService.follow(followingId));

  unfollow = (followingId: number): Promise<void> =>
    this.#setFollowing(followingId, false, () => socialService.unfollow(followingId));

  /**
   * Like / unlike a market target. The liked lists are not part of this slice's
   * replica, so there is no local view to refresh — the call just reports the
   * new state for the caller.
   */
  toggleLike = async (
    targetType: SocialTargetType,
    targetId: number,
  ): Promise<{ liked: boolean }> => socialService.toggleLike(targetType, targetId);
}

export type SocialAction = Pick<SocialActionImpl, keyof SocialActionImpl>;
