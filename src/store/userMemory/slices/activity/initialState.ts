import { type ActivityListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type ActivityListData, type ActivityListSort } from './projection';

/**
 * The activity list is a `@lobechat/replica` paged resource. Its canonical
 * value lives in `activityListData`; the long-standing flat fields
 * (`activities`, `activitiesTotal`, `activitiesPage`, `activitiesHasMore`,
 * `activitiesInit`) are derived mirrors of that view so every existing
 * consumer keeps reading the place it always has.
 */
export interface ActivitySliceState {
  /** Rows of the loaded page set. Mirror of `activityListData.items`. */
  activities: ActivityListItem[];
  /** Mirror of `activityListData.hasMore`. */
  activitiesHasMore: boolean;
  /** Whether the replica view exists (persisted row hydrated or a page landed). */
  activitiesInit: boolean;
  /** Mirror of `activityListData.currentPage + 1`. */
  activitiesPage: number;
  activitiesQuery?: string;
  activitiesSearchError?: unknown;
  activitiesSearchLoading?: boolean;
  activitiesSort?: ActivityListSort;
  /** Mirror of `activityListData.total`. */
  activitiesTotal: number;
  /**
   * Canonical replica view of the activity list — the single source of truth
   * behind every `activities*` field above. Engine-owned; readers use the flat
   * mirrors.
   */
  activityListData?: ActivityListData;
  /** Local-first bookkeeping for `activityListData`. */
  activityListReplica: ReplicaState<ActivityListData>;
}

export const activityInitialState: ActivitySliceState = {
  activities: [],
  activitiesHasMore: true,
  activitiesInit: false,
  activitiesPage: 1,
  activitiesQuery: undefined,
  activitiesSearchError: undefined,
  activitiesSearchLoading: undefined,
  activitiesSort: undefined,
  activitiesTotal: 0,
  activityListData: undefined,
  activityListReplica: createReplicaState<ActivityListData>(),
};
