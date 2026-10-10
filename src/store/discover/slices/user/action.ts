import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import { type DiscoverUserProfile } from '@/types/discover';
import { setNamespace } from '@/utils/storeDebug';

import { type UserProfileParams, userProfileQueryKey, userProfileResource } from './projection';

const n = setNamespace('discover/user');

/**
 * Sync flags of a community profile read, plus the aliases the old SWR hook
 * returned (`isLoading` / `mutate`) so a call site only has to move its `data`
 * read to `userSelectors.userProfile(fetchHook.queryKey)`.
 */
export interface UserProfileSyncResult extends ReplicaSyncResult {
  /** A request is in flight and this entry has no value to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the value with `userSelectors.userProfile(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

type Setter = StoreSetter<DiscoverStore>;

export const createUserSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new UserActionImpl(set, get, _api);

export class UserActionImpl {
  readonly #get: () => DiscoverStore;
  readonly #profile;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#profile = createReplicaSlice(userProfileResource, {
      actionPrefix: n('profile'),
      get,
      set,
      stateKey: 'userProfileReplica',
      view: recordLens<DiscoverStore, DiscoverUserProfile>('userProfileMap'),
    });
  }

  /**
   * A community user / organization profile by username. Read it with
   * `userSelectors.userProfile(queryKey)`; `undefined` while unloaded or for a
   * handle the server does not know. A blank username disables the read.
   */
  useUserProfile = (params: { username: string }): UserProfileSyncResult => {
    const active = params.username.length > 0;
    const normalized: UserProfileParams = {
      locale: globalHelpers.getCurrentLanguage(),
      username: params.username,
    };
    const queryKey = userProfileQueryKey(normalized);
    const sync = this.#profile.useSync(active ? normalized : null, { enabled: active });

    return {
      ...sync,
      isLoading:
        active &&
        this.#get().userProfileMap[queryKey] === undefined &&
        (!sync.isHydrated || sync.isValidating),
      mutate: sync.revalidate,
      queryKey: active ? queryKey : undefined,
    };
  };
}

export type UserAction = Pick<UserActionImpl, keyof UserActionImpl>;
