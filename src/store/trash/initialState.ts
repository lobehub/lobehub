import type {
  TrashCountByType,
  TrashItem,
  TrashProjectFilter,
  TrashResourceType,
} from '@lobechat/types';

import { createReplicaState, type ReplicaPagedData, type ReplicaState } from '@/libs/replica';

/** One recycle-bin view's page: the generic local-first paged view. */
export type TrashListData = ReplicaPagedData<TrashItem, string>;

/**
 * The project filter and the cache scope (user + workspace) it was chosen in.
 * A project belongs to one scope, so the filter only applies there: after a
 * scope switch the bin opens on every project instead of asking another scope
 * for a project it does not have.
 */
export interface TrashProjectSelection {
  projectId: TrashProjectFilter;
  scope: string;
}

export interface TrashState {
  /** Type filter the recycle-bin page is currently showing (`undefined` = everything). */
  activeType?: TrashResourceType;
  /** Registry ids with an in-flight restore / purge — drives per-row spinners. */
  loadingIds: string[];
  /** Project filter, bound to its scope (`undefined` = every project). */
  projectSelection?: TrashProjectSelection;
  /** Per-type counts per project filter (`trashCountMap[trashCountKey(projectId)]`). */
  trashCountMap: Record<string, TrashCountByType>;
  /** Local-first bookkeeping for `trashCountMap`. */
  trashCountReplica: ReplicaState<TrashCountByType>;
  /** Recycle-bin rows per view (`trashListMap[trashListKey(filter)]`). */
  trashListMap: Record<string, TrashListData>;
  /** Local-first bookkeeping for `trashListMap`. */
  trashListReplica: ReplicaState<TrashListData>;
}

export const initialState: TrashState = {
  activeType: undefined,
  loadingIds: [],
  projectSelection: undefined,
  trashCountMap: {},
  trashCountReplica: createReplicaState(),
  trashListMap: {},
  trashListReplica: createReplicaState(),
};
