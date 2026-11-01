import type {
  AgentEvalRunDetail,
  AgentEvalRunListItem,
  AgentEvalRunResults,
} from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface RunSliceState {
  /**
   * Map of run lists keyed by datasetId
   * Caches dataset-scoped run lists for multiple dataset detail pages
   */
  datasetRunListMap: Record<string, AgentEvalRunListItem[]>;
  /** Local-first bookkeeping for `datasetRunListMap`. */
  datasetRunListReplica: ReplicaState<AgentEvalRunListItem[]>;
  isCreatingRun: boolean;
  /** By-id run detail cache (`runDetailMap[runId]`). */
  runDetailMap: Record<string, AgentEvalRunDetail>;
  /** Local-first bookkeeping for `runDetailMap`. */
  runDetailReplica: ReplicaState<AgentEvalRunDetail>;
  /**
   * Benchmark-level run list keyed by benchmarkId
   * (all runs, used by sidebar and benchmark detail)
   */
  runListMap: Record<string, AgentEvalRunListItem[]>;
  /** Local-first bookkeeping for `runListMap`. */
  runListReplica: ReplicaState<AgentEvalRunListItem[]>;
  /** By-id run results cache (`runResultsMap[runId]`). */
  runResultsMap: Record<string, AgentEvalRunResults>;
  /** Local-first bookkeeping for `runResultsMap`. */
  runResultsReplica: ReplicaState<AgentEvalRunResults>;
}

export const runInitialState: RunSliceState = {
  datasetRunListMap: {},
  datasetRunListReplica: createReplicaState(),
  isCreatingRun: false,
  runDetailMap: {},
  runDetailReplica: createReplicaState(),
  runListMap: {},
  runListReplica: createReplicaState(),
  runResultsMap: {},
  runResultsReplica: createReplicaState(),
};
