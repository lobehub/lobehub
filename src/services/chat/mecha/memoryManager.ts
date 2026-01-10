import type { UserMemoryData, UserMemoryIdentityItem } from '@lobechat/context-engine';
import type { RetrieveMemoryResult } from '@lobechat/types';

import { mutate } from '@/libs/swr';
import { userMemoryService } from '@/services/userMemory';
import { getChatStoreState } from '@/store/chat';
import { getUserMemoryStoreState, useUserMemoryStore } from '@/store/userMemory';
import { agentMemorySelectors, identitySelectors } from '@/store/userMemory/selectors';

const EMPTY_MEMORIES: RetrieveMemoryResult = {
  contexts: [],
  experiences: [],
  preferences: [],
};

/**
 * Resolves global identities from user memory store
 * Returns identities that apply across all topics
 */
export const resolveGlobalIdentities = (): UserMemoryIdentityItem[] => {
  const memoryState = getUserMemoryStoreState();
  const globalIdentities = identitySelectors.globalIdentities(memoryState);

  return globalIdentities.map((identity) => ({
    capturedAt: identity.capturedAt,
    description: identity.description,
    id: identity.id,
    role: identity.role,
    type: identity.type,
  }));
};

/**
 * Context for resolving topic memories
 */
export interface TopicMemoryResolverContext {
  /** Topic ID to retrieve memories for (optional, will use active topic if not provided) */
  topicId?: string;
}

/**
 * Resolves topic-based memories (contexts, experiences, preferences)
 *
 * This function handles:
 * 1. Getting the topic ID from context or active topic
 * 2. Checking if memories are already cached for the topic
 * 3. Fetching memories from the service if not cached
 * 4. Caching the fetched memories by topic ID
 */
export const resolveTopicMemories = async (
  ctx?: TopicMemoryResolverContext,
): Promise<RetrieveMemoryResult> => {
  // Get topic ID from context or active topic
  const topicId = ctx?.topicId ?? getChatStoreState().activeTopicId;

  // If no topic ID, return empty memories
  if (!topicId) {
    return EMPTY_MEMORIES;
  }

  const userMemoryStoreState = getUserMemoryStoreState();

  // Check if already have cached memories for this topic
  const cachedMemories = agentMemorySelectors.topicMemories(topicId)(userMemoryStoreState);

  if (cachedMemories) {
    return cachedMemories;
  }

  // Fetch memories for this topic
  try {
    const result = await userMemoryService.retrieveMemoryForTopic(topicId);
    const memories = result ?? EMPTY_MEMORIES;

    // Cache the fetched memories by topic ID
    useUserMemoryStore.setState((state) => ({
      topicMemoriesMap: {
        ...state.topicMemoriesMap,
        [topicId]: memories,
      },
    }));

    // Also trigger SWR mutate to keep in sync
    await mutate(['useFetchMemoriesForTopic', topicId]);

    return memories;
  } catch (error) {
    console.error('Failed to retrieve memories for topic:', error);
    return EMPTY_MEMORIES;
  }
};

/**
 * Combines topic memories and global identities into UserMemoryData
 * This is a utility for assembling the final memory data structure
 */
export const combineUserMemoryData = (
  topicMemories: RetrieveMemoryResult,
  identities: UserMemoryIdentityItem[],
): UserMemoryData => ({
  contexts: topicMemories.contexts,
  experiences: topicMemories.experiences,
  identities,
  preferences: topicMemories.preferences,
});
