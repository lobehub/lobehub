import type { AgentEvalDatasetListItem, AgentEvalRunListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type {
  CasesByDataset,
  EvalEnvironmentRow,
  LobeBenchCase,
  RunResultsByRun,
} from './projection';

/** Replica views of the Lobe Bench pages; a missing entry is the loading signal. */
export interface LobeBenchSliceState {
  /** Cases of several datasets, keyed by `idSetKey(datasetIds)`. */
  casesByDatasetMap: Record<string, CasesByDataset>;
  casesByDatasetReplica: ReplicaState<CasesByDataset>;
  /** All cases of a dataset, keyed by dataset id. */
  datasetCaseListMap: Record<string, LobeBenchCase[]>;
  datasetCaseListReplica: ReplicaState<LobeBenchCase[]>;
  /** Case environments of the active scope, under `ENVIRONMENT_LIST_KEY`. */
  environmentListMap: Record<string, EvalEnvironmentRow[]>;
  environmentListReplica: ReplicaState<EvalEnvironmentRow[]>;
  /** Runs of one experiment, keyed by experiment id. */
  experimentRunListMap: Record<string, AgentEvalRunListItem[]>;
  experimentRunListReplica: ReplicaState<AgentEvalRunListItem[]>;
  /** Lobe Bench datasets, keyed by `idSetKey(benchmarkIds)`. */
  lobeBenchDatasetListMap: Record<string, AgentEvalDatasetListItem[]>;
  lobeBenchDatasetListReplica: ReplicaState<AgentEvalDatasetListItem[]>;
  /** Runs under the Lobe Bench benchmarks, keyed by `idSetKey(benchmarkIds)`. */
  lobeBenchRunListMap: Record<string, AgentEvalRunListItem[]>;
  lobeBenchRunListReplica: ReplicaState<AgentEvalRunListItem[]>;
  /** Per-case results of several runs, keyed by `idSetKey(runIds)`. */
  runResultsByRunMap: Record<string, RunResultsByRun>;
  runResultsByRunReplica: ReplicaState<RunResultsByRun>;
}

export const lobeBenchInitialState: LobeBenchSliceState = {
  casesByDatasetMap: {},
  casesByDatasetReplica: createReplicaState(),
  datasetCaseListMap: {},
  datasetCaseListReplica: createReplicaState(),
  environmentListMap: {},
  environmentListReplica: createReplicaState(),
  experimentRunListMap: {},
  experimentRunListReplica: createReplicaState(),
  lobeBenchDatasetListMap: {},
  lobeBenchDatasetListReplica: createReplicaState(),
  lobeBenchRunListMap: {},
  lobeBenchRunListReplica: createReplicaState(),
  runResultsByRunMap: {},
  runResultsByRunReplica: createReplicaState(),
};
