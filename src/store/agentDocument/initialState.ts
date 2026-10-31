import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { AgentDocumentListItem } from '@/services/agentDocument';

import type { AgentDocumentReaderDetail } from './projection';

export interface AgentDocumentState {
  /** Full document list per agent (`agentDocumentListMap[agentId]`). */
  agentDocumentListMap: Record<string, AgentDocumentListItem[]>;
  /** Replica bookkeeping for `agentDocumentListMap`. */
  agentDocumentListReplica: ReplicaState<AgentDocumentListItem[]>;
  /** Reader documents (`agentDocumentReaderMap[agentDocumentReaderKey(params)]`). */
  agentDocumentReaderMap: Record<string, AgentDocumentReaderDetail>;
  /** Replica bookkeeping for `agentDocumentReaderMap`. */
  agentDocumentReaderReplica: ReplicaState<AgentDocumentReaderDetail>;
}

export const initialState: AgentDocumentState = {
  agentDocumentListMap: {},
  agentDocumentListReplica: createReplicaState(),
  agentDocumentReaderMap: {},
  agentDocumentReaderReplica: createReplicaState(),
};
