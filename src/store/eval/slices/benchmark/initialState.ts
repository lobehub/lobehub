import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { BenchmarkDetail, BenchmarkListItem } from './projection';

export interface BenchmarkSliceState {
  /** Replica view of the benchmark details, one entry per benchmark id. */
  benchmarkDetailMap: Record<string, BenchmarkDetail>;
  /** Replica bookkeeping of `benchmarkDetailMap`. */
  benchmarkDetailReplica: ReplicaState<BenchmarkDetail>;
  /** Replica view of the benchmark list (one entry per cache scope). */
  benchmarkList: BenchmarkListItem[];
  /**
   * Whether the list has ever been hydrated or fetched. Keeps a loaded-but-
   * empty list distinguishable from one that was never loaded, so the sidebar
   * shows its skeleton instead of a premature empty state.
   */
  benchmarkListInit: boolean;
  /** Replica bookkeeping of `benchmarkList`. */
  benchmarkListReplica: ReplicaState<BenchmarkListItem[]>;
}

export const benchmarkInitialState: BenchmarkSliceState = {
  benchmarkDetailMap: {},
  benchmarkDetailReplica: createReplicaState(),
  benchmarkList: [],
  benchmarkListInit: false,
  benchmarkListReplica: createReplicaState(),
};
