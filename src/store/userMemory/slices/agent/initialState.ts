import { type RetrieveMemoryResult } from '@/types/userMemory';

export interface AgentMemorySliceState {
  /**
   * Topic-based memory cache for agent context injection
   * Key is topicId, value is the retrieved memories for that topic
   */
  topicMemoriesMap: Record<string, RetrieveMemoryResult>;
}

export const agentMemoryInitialState: AgentMemorySliceState = {
  topicMemoriesMap: {},
};
