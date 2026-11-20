import { type ActivityListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { memoryListKey } from '../../utils/replica';
import { type ActivityListData, type ActivityListSort } from './projection';

/**
 * The activity list is a `local-replica` paged resource with one page set
 * per search / sort (`activityListEntries`). The long-standing flat fields
 * (`activityListData`, `activities`, `activitiesTotal`, `activitiesPage`,
 * `activitiesHasMore`, `activitiesInit`) mirror the active query's entry so every
 * existing consumer keeps reading the place it always has.
 */
export interface ActivitySliceState {
  /** Rows of the active page set. Mirror of `activityListData.items`. */
  activities: ActivityListItem[];
  /** Mirror of `activityListData.hasMore`. */
  activitiesHasMore: boolean;
  /** Whether the active query has a view (persisted row hydrated or a page landed). */
  activitiesInit: boolean;
  /** Mirror of `activityListData.currentPage + 1`. */
  activitiesPage: number;
  activitiesQuery?: string;
  activitiesSort?: ActivityListSort;
  /** Mirror of `activityListData.total`. */
  activitiesTotal: number;
  /** View of the active query's page set. Mirror of `activityListEntries[activityListKey]`. */
  activityListData?: ActivityListData;
  /** Canonical replica views, one page set per query. Engine-owned. */
  activityListEntries: Record<string, ActivityListData>;
  /** Entry key of the query on screen (see `memoryListKey`). */
  activityListKey: string;
  /** Local-first bookkeeping for `activityListEntries`. */
  activityListReplica: ReplicaState<ActivityListData>;
}

export const activityInitialState: ActivitySliceState = {
  activities: [],
  activitiesHasMore: true,
  activitiesInit: false,
  activitiesPage: 1,
  activitiesQuery: undefined,
  activitiesSort: undefined,
  activitiesTotal: 0,
  activityListData: undefined,
  activityListEntries: {},
  activityListKey: memoryListKey({}),
  activityListReplica: createReplicaState<ActivityListData>(),
};
