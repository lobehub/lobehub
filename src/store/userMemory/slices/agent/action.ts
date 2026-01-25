import { omit } from 'es-toolkit';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { userMemoryService } from '@/services/userMemory';
import type { RetrieveMemoryResult } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';

const n = setNamespace('userMemory/agent');

export interface AgentMemoryAction {
  /**
   * Clear memories for a specific topic (e.g., when topic is deleted)
   */
  clearTopicMemories: (topicId: string) => void;

  /**
   * Fetch and cache memories for a specific topic
   * Uses SWR for caching and revalidation
   */
  useFetchMemoriesForTopic: (topicId?: string | null) => SWRResponse<RetrieveMemoryResult>;
}

export const createAgentMemorySlice: StateCreator<
  UserMemoryStore,
  [['zustand/devtools', never]],
  [],
  AgentMemoryAction
> = (set, get) => ({
  clearTopicMemories: (topicId) => {
    set(
      { topicMemoriesMap: omit(get().topicMemoriesMap, [topicId]) },
      false,
      n('clearTopicMemories', { topicId }),
    );
  },

  useFetchMemoriesForTopic: (topicId) =>
    useClientDataSWRWithSync<RetrieveMemoryResult>(
      topicId ? ['useFetchMemoriesForTopic', topicId] : null,
      async () => {
        // Retrieve memories using topic's context
        // The backend will use topic info to build the query
        return await userMemoryService.retrieveMemoryForTopic(topicId!);
      },
      {
        onData: (data) => {
          if (!topicId || !data) return;

          set(
            (state) => ({
              topicMemoriesMap: { ...state.topicMemoriesMap, [topicId]: data },
            }),
            false,
            n('useFetchMemoriesForTopic/success', {
              activitiesCount: data.activities?.length ?? 0,
              contextsCount: data.contexts?.length ?? 0,
              experiencesCount: data.experiences?.length ?? 0,
              preferencesCount: data.preferences?.length ?? 0,
              topicId,
            }),
          );
        },
        revalidateOnFocus: false,
      },
    ),
});
