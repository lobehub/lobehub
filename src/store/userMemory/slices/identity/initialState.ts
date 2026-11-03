import { type IdentityListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type IdentityForInjection } from '../../types';
import { memoryListKey } from '../../utils/replica';
import {
  DEFAULT_IDENTITY_LIST_PAGE_SIZE,
  type IdentityListMeta,
  type IdentityListView,
} from './projection';

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
  /** Paging bookkeeping of the active query's page set (mirror). */
  identitiesMeta?: IdentityListMeta;
  /** Replica bookkeeping for `identityListEntries`. */
  identitiesReplica: ReplicaState<IdentityListView>;
  /**
   * Canonical replica views of the identity list, one page set per search /
   * filter / sort. `identities` / `identitiesMeta` mirror the active one.
   */
  identityListEntries: Record<string, IdentityListView>;
  /** Entry key of the query on screen (see `memoryListKey`). */
  identityListKey: string;
}

export const identityInitialState: IdentitySliceState = {
  globalIdentities: [],
  globalIdentitiesInit: false,
  globalIdentitiesReplica: createReplicaState(),
  identities: [],
  identitiesInit: false,
  identitiesMeta: undefined,
  identitiesReplica: createReplicaState(),
  identityListEntries: {},
  identityListKey: memoryListKey({ pageSize: DEFAULT_IDENTITY_LIST_PAGE_SIZE }),
};
