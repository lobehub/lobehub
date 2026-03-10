import { type RetrieveMemoryResult } from '@/types/userMemory';

import { type UserMemoryStoreState } from '../../initialState';

export const agentMemorySelectors = {
  /**
   * Check if memories exist for a specific topic
   */
  hasTopicMemories:
    (topicId: string | undefined) =>
    (state: UserMemoryStoreState): boolean => {
      if (!topicId) return false;
      return !!state.topicMemoriesMap[topicId];
    },

  /**
   * Get memories for a specific topic
   */
  topicMemories:
    (topicId: string | undefined) =>
    (state: UserMemoryStoreState): RetrieveMemoryResult | undefined => {
      if (!topicId) return undefined;
      return state.topicMemoriesMap[topicId];
    },
};
