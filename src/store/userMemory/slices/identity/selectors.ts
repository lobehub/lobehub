import { type UserMemoryStoreState } from '../../initialState';
import { type IdentityForInjection } from '../../types';

export const identitySelectors = {
  /**
   * Get global identities for chat context injection
   */
  globalIdentities: (state: UserMemoryStoreState): IdentityForInjection[] => state.globalIdentities,

  /**
   * Check if global identities have been initialized
   */
  globalIdentitiesInit: (state: UserMemoryStoreState): boolean => state.globalIdentitiesInit,

  /**
   * Check if there are any global identities
   */
  hasGlobalIdentities: (state: UserMemoryStoreState): boolean => state.globalIdentities.length > 0,

  /**
   * Whether the identity list has loaded its first page. The page controls stay
   * mounted across a query change, so this survives a search reset.
   */
  isIdentitiesInitialized: (state: UserMemoryStoreState): boolean => state.identitiesInit,

  /** Whether another identity page can be appended after the loaded ones. */
  identitiesHasMore: (state: UserMemoryStoreState): boolean =>
    state.identitiesMeta?.hasMore ?? false,

  /** Whether a "load more" request for the next identity page is in flight. */
  identitiesIsLoadingMore: (state: UserMemoryStoreState): boolean =>
    state.identitiesMeta?.isLoadingMore ?? false,

  /** Failure of the last "load more" request, cleared by the next attempt. */
  identitiesLoadMoreError: (state: UserMemoryStoreState): unknown =>
    state.identitiesMeta?.loadMoreError,

  /** Row count of the *current* query, not the whole collection. */
  identitiesTotal: (state: UserMemoryStoreState): number => state.identitiesMeta?.total ?? 0,
};
