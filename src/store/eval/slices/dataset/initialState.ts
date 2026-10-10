import { type AgentEvalDataset, type AgentEvalDatasetListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface DatasetSliceState {
  /** Replica view of the dataset pages, one entry per dataset id. */
  datasetDetailMap: Record<string, AgentEvalDataset>;
  /** Replica bookkeeping of `datasetDetailMap`. */
  datasetDetailReplica: ReplicaState<AgentEvalDataset>;
  /**
   * Replica view of the dataset lists, keyed by scope: one entry per benchmark
   * id, plus `all` for every dataset of the active scope. A missing entry is
   * the loading signal.
   */
  datasetListMap: Record<string, AgentEvalDatasetListItem[]>;
  /** Replica bookkeeping of `datasetListMap`. */
  datasetListReplica: ReplicaState<AgentEvalDatasetListItem[]>;
}

export const datasetInitialState: DatasetSliceState = {
  datasetDetailMap: {},
  datasetDetailReplica: createReplicaState(),
  datasetListMap: {},
  datasetListReplica: createReplicaState(),
};
