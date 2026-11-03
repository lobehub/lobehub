import { type UserMemoryData } from '@lobechat/context-engine';
import { type RetrieveMemoryResult } from '@lobechat/types';

import { getChatStoreState } from '@/store/chat';
import { getUserMemoryStoreState } from '@/store/userMemory';
import { agentMemorySelectors } from '@/store/userMemory/selectors';

type UserMemoryPersona = UserMemoryData['persona'];

const EMPTY_MEMORIES: RetrieveMemoryResult = {
  activities: [],
  contexts: [],
  experiences: [],
  preferences: [],
};

/**
 * Resolves user persona from user memory store
 */
export const resolveUserPersona = (): UserMemoryPersona | undefined => {
  const memoryState = getUserMemoryStoreState();
  const persona = memoryState.persona;

  if (!persona?.content && !persona?.summary) return undefined;

  return {
    narrative: persona.content,
    tagline: persona.summary,
  };
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
 * Combines topic memories and user persona into UserMemoryData
 * This is a utility for assembling the final memory data structure
 */
export const combineUserMemoryData = (
  topicMemories: RetrieveMemoryResult,
  persona?: UserMemoryPersona,
): UserMemoryData => ({
  activities: topicMemories.activities,
  contexts: topicMemories.contexts,
  experiences: topicMemories.experiences,
  persona,
  preferences: topicMemories.preferences,
});
