import { type ExperienceListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type ExperienceListData, type ExperienceListSort } from './projection';

/**
 * The experience list is a `@lobechat/replica` paged resource. Its canonical
 * value lives in `experienceListData`; the long-standing flat fields
 * (`experiences`, `experiencesTotal`, `experiencesPage`, `experiencesHasMore`,
 * `experiencesInit`) are derived mirrors of that view so every existing
 * consumer keeps reading the place it always has.
 */
export interface ExperienceSliceState {
  /**
   * Canonical replica view of the experience list — the single source of truth
   * behind every `experiences*` field above. Engine-owned; readers use the flat
   * mirrors.
   */
  experienceListData?: ExperienceListData;
  /** Local-first bookkeeping for `experienceListData`. */
  experienceListReplica: ReplicaState<ExperienceListData>;
  /** Rows of the loaded page set. Mirror of `experienceListData.items`. */
  experiences: ExperienceListItem[];
  /** Mirror of `experienceListData.hasMore`. */
  experiencesHasMore: boolean;
  /** Whether the replica view exists (persisted row hydrated or a page landed). */
  experiencesInit: boolean;
  /** Mirror of `experienceListData.currentPage + 1`. */
  experiencesPage: number;
  experiencesQuery?: string;
  experiencesSearchError?: unknown;
  experiencesSearchLoading?: boolean;
  experiencesSort?: ExperienceListSort;
  /** Mirror of `experienceListData.total`. */
  experiencesTotal: number;
}

export const experienceInitialState: ExperienceSliceState = {
  experiences: [],
  experiencesHasMore: true,
  experiencesInit: false,
  experiencesPage: 1,
  experiencesQuery: undefined,
  experiencesSearchError: undefined,
  experiencesSearchLoading: undefined,
  experiencesSort: undefined,
  experiencesTotal: 0,
  experienceListData: undefined,
  experienceListReplica: createReplicaState<ExperienceListData>(),
};
