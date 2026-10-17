import { type ExperienceListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { memoryListKey } from '../../utils/replica';
import { type ExperienceListData, type ExperienceListSort } from './projection';

/**
 * The experience list is a `@lobechat/replica` paged resource with one page set
 * per search / sort (`experienceListEntries`). The long-standing flat fields
 * (`experienceListData`, `experiences`, `experiencesTotal`, `experiencesPage`,
 * `experiencesHasMore`, `experiencesInit`) mirror the active query's entry so every
 * existing consumer keeps reading the place it always has.
 */
export interface ExperienceSliceState {
  /** View of the active query's page set. Mirror of `experienceListEntries[experienceListKey]`. */
  experienceListData?: ExperienceListData;
  /** Canonical replica views, one page set per query. Engine-owned. */
  experienceListEntries: Record<string, ExperienceListData>;
  /** Entry key of the query on screen (see `memoryListKey`). */
  experienceListKey: string;
  /** Local-first bookkeeping for `experienceListEntries`. */
  experienceListReplica: ReplicaState<ExperienceListData>;
  /** Rows of the active page set. Mirror of `experienceListData.items`. */
  experiences: ExperienceListItem[];
  /** Mirror of `experienceListData.hasMore`. */
  experiencesHasMore: boolean;
  /** Whether the active query has a view (persisted row hydrated or a page landed). */
  experiencesInit: boolean;
  /** Mirror of `experienceListData.currentPage + 1`. */
  experiencesPage: number;
  experiencesQuery?: string;
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
  experiencesSort: undefined,
  experiencesTotal: 0,
  experienceListData: undefined,
  experienceListEntries: {},
  experienceListKey: memoryListKey({}),
  experienceListReplica: createReplicaState<ExperienceListData>(),
};
