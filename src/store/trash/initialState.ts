import type { TrashCountByType, TrashItem, TrashResourceType } from '@lobechat/types';

import { createReplicaState, type ReplicaPagedData, type ReplicaState } from '@/libs/replica';

/** One type-filter's recycle-bin page: the generic local-first paged view. */
export type TrashListData = ReplicaPagedData<TrashItem, string>;

export interface TrashState {
  /** Type filter the recycle-bin page is currently showing (`undefined` = everything). */
  activeType?: TrashResourceType;
  /** Registry ids with an in-flight restore / purge — drives per-row spinners. */
  loadingIds: string[];
  /** Per-type counts (`trashCountMap.all`): the filter chips and the empty total. */
  trashCountMap: Record<string, TrashCountByType>;
  /** Local-first bookkeeping for `trashCountMap`. */
  trashCountReplica: ReplicaState<TrashCountByType>;
  /** Recycle-bin rows per filter (`trashListMap[resourceType ?? 'all']`). */
  trashListMap: Record<string, TrashListData>;
  /** Local-first bookkeeping for `trashListMap`. */
  trashListReplica: ReplicaState<TrashListData>;
}

export const initialState: TrashState = {
  activeType: undefined,
  loadingIds: [],
  trashCountMap: {},
  trashCountReplica: createReplicaState(),
  trashListMap: {},
  trashListReplica: createReplicaState(),
};
