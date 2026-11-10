import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type BriefItem } from '@/store/brief/types';

export interface BriefListState {
  /** The unresolved feed — the view of the `briefList` replica (`briefListMap[BRIEF_LIST_KEY]`). */
  briefListMap: Record<string, BriefItem[]>;
  /** Replica bookkeeping for `briefListMap`. */
  briefListReplica: ReplicaState<BriefItem[]>;
}

export const initialBriefListState: BriefListState = {
  briefListMap: {},
  briefListReplica: createReplicaState(),
};
