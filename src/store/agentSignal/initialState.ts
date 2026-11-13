import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { AgentSignalReceiptView } from './projection';

export interface AgentSignalState {
  /** Receipts per agent topic (`agentSignalReceiptsMap[agentSignalReceiptsKey(params)]`). */
  agentSignalReceiptsMap: Record<string, AgentSignalReceiptView[]>;
  /** Replica bookkeeping for `agentSignalReceiptsMap`. */
  agentSignalReceiptsReplica: ReplicaState<AgentSignalReceiptView[]>;
}

export const initialState: AgentSignalState = {
  agentSignalReceiptsMap: {},
  agentSignalReceiptsReplica: createReplicaState(),
};
