import { type UserMemoryData, type UserMemoryIdentityItem } from '@lobechat/context-engine';
import { type RetrieveMemoryResult } from '@lobechat/types';

import { getChatStoreState } from '@/store/chat';
import { getUserMemoryStoreState } from '@/store/userMemory';
import { agentMemorySelectors, identitySelectors } from '@/store/userMemory/selectors';

const EMPTY_MEMORIES: RetrieveMemoryResult = {
  activities: [],
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
 * Resolves topic-based memories (contexts, experiences, preferences) from cache only.
 *
 * This function only reads from cache and does NOT trigger network requests.
 * Memory data is pre-loaded by SWR in ChatList via useFetchTopicMemories hook.
 * This ensures sendMessage is not blocked by memory retrieval network calls.
 */
export const resolveTopicMemories = (ctx?: TopicMemoryResolverContext): RetrieveMemoryResult => {
  // Get topic ID from context or active topic
  const topicId = ctx?.topicId ?? getChatStoreState().activeTopicId;

  // If no topic ID, return empty memories
  if (!topicId) {
    return EMPTY_MEMORIES;
  }

  const userMemoryStoreState = getUserMemoryStoreState();

  // Only read from cache, do not trigger network request
  // Memory data is pre-loaded by SWR in ChatList
  const cachedMemories = agentMemorySelectors.topicMemories(topicId)(userMemoryStoreState);

  return cachedMemories ?? EMPTY_MEMORIES;
};

/**
 * Combines topic memories and global identities into UserMemoryData
 * This is a utility for assembling the final memory data structure
 */
export const combineUserMemoryData = (
  topicMemories: RetrieveMemoryResult,
  identities: UserMemoryIdentityItem[],
): UserMemoryData => ({
  activities: topicMemories.activities,
  contexts: topicMemories.contexts,
  experiences: topicMemories.experiences,
  identities,
  preferences: topicMemories.preferences,
});
