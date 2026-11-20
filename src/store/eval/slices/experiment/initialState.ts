import type { AgentEvalExperimentDetail, AgentEvalExperimentListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface ExperimentSliceState {
  /** Replica view of the experiment details, one entry per experiment id. */
  experimentDetailMap: Record<string, AgentEvalExperimentDetail>;
  /** Replica bookkeeping of `experimentDetailMap`. */
  experimentDetailReplica: ReplicaState<AgentEvalExperimentDetail>;
  /** Replica view of the experiment list (one entry per cache scope). */
  experimentList: AgentEvalExperimentListItem[];
  /**
   * Whether the list has ever been hydrated or fetched. Keeps a loaded-but-
   * empty list distinguishable from one that was never loaded, so the sidebar
   * shows its skeleton instead of a premature empty state.
   */
  experimentListInit: boolean;
  /** Replica bookkeeping of `experimentList`. */
  experimentListReplica: ReplicaState<AgentEvalExperimentListItem[]>;
}

export const experimentInitialState: ExperimentSliceState = {
  experimentDetailMap: {},
  experimentDetailReplica: createReplicaState(),
  experimentList: [],
  experimentListInit: false,
  experimentListReplica: createReplicaState(),
};
