import { type IdentityListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type IdentityForInjection } from '../../types';
import { type IdentityListMeta, type IdentityListView } from './projection';

export interface IdentitySliceState {
  /**
   * The caller's own identities injected into the chat context — the view of
   * the `globalIdentities` replica. Consumers read it through
   * `identitySelectors.globalIdentities`.
   */
  globalIdentities: IdentityForInjection[];
  /** Whether global identities have been initialized */
  globalIdentitiesInit: boolean;
  /** Replica bookkeeping for `globalIdentities`. */
  globalIdentitiesReplica: ReplicaState<IdentityForInjection[]>;

  /**
   * Rows of the identities list — the view of the `identityList` replica, kept
   * as a flat array where every existing reader expects it. The paging
   * bookkeeping lives beside it in `identitiesMeta`.
   */
  identities: IdentityListItem[];
  /**
   * `true` once the first identity page has landed. Stays `true` across a query
   * change (only a scope switch clears it), so the page controls are not torn
   * down while a new search resolves.
   */
  identitiesInit: boolean;
  /** Paging bookkeeping of `identities` (part of the replica view). */
  identitiesMeta?: IdentityListMeta;
  /** Replica bookkeeping for `identityList`. */
  identitiesReplica: ReplicaState<IdentityListView>;
}

export const identityInitialState: IdentitySliceState = {
  globalIdentities: [],
  globalIdentitiesInit: false,
  globalIdentitiesReplica: createReplicaState(),
  identities: [],
  identitiesInit: false,
  identitiesMeta: undefined,
  identitiesReplica: createReplicaState(),
};
