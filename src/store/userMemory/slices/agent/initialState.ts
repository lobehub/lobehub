import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type RetrieveMemoryResult } from '@/types/userMemory';

export interface AgentMemorySliceState {
  /**
   * Topic-based memory cache for agent context injection.
   * Key is topicId, value is the retrieved memories for that topic.
   * This is the view of the `topicMemoriesResource` replica.
   */
  topicMemoriesMap: Record<string, RetrieveMemoryResult>;
  /** Replica bookkeeping of `topicMemoriesMap`. */
  topicMemoriesReplica: ReplicaState<RetrieveMemoryResult>;
}

export const agentMemoryInitialState: AgentMemorySliceState = {
  topicMemoriesMap: {},
  topicMemoriesReplica: createReplicaState(),
};
