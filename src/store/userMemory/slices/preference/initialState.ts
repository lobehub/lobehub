import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type PreferenceListData, type PreferenceListSort } from './projection';

/**
 * The preference list is a `@lobechat/replica` paged resource. Its canonical
 * value lives in `preferenceListData`; the long-standing flat fields
 * (`preferences`, `preferencesTotal`, `preferencesPage`, `preferencesHasMore`,
 * `preferencesInit`) are derived mirrors of that view so every existing
 * consumer keeps reading the place it always has.
 */
export interface PreferenceSliceState {
  /**
   * Canonical replica view of the preference list — the single source of truth
   * behind every `preferences*` field above. Engine-owned; readers use the flat
   * mirrors.
   */
  preferenceListData?: PreferenceListData;
  /** Local-first bookkeeping for `preferenceListData`. */
  preferenceListReplica: ReplicaState<PreferenceListData>;
  /** Rows of the loaded page set. Mirror of `preferenceListData.items`. */
  preferences: DisplayPreferenceMemory[];
  /** Mirror of `preferenceListData.hasMore`. */
  preferencesHasMore: boolean;
  /** Whether the replica view exists (persisted row hydrated or a page landed). */
  preferencesInit: boolean;
  /** Mirror of `preferenceListData.currentPage + 1`. */
  preferencesPage: number;
  preferencesQuery?: string;
  preferencesSearchError?: unknown;
  preferencesSearchLoading?: boolean;
  preferencesSort?: PreferenceListSort;
  /** Mirror of `preferenceListData.total`. */
  preferencesTotal: number;
}

export const preferenceInitialState: PreferenceSliceState = {
  preferences: [],
  preferencesHasMore: true,
  preferencesInit: false,
  preferencesPage: 1,
  preferencesQuery: undefined,
  preferencesSearchError: undefined,
  preferencesSearchLoading: undefined,
  preferencesSort: undefined,
  preferencesTotal: 0,
  preferenceListData: undefined,
  preferenceListReplica: createReplicaState<PreferenceListData>(),
};
