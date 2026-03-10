import { omit } from 'es-toolkit';
import { type SWRResponse } from 'swr';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { type RetrieveMemoryResult } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';

const n = setNamespace('userMemory/agent');

type Setter = StoreSetter<UserMemoryStore>;
export const createAgentMemorySlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new AgentMemoryActionImpl(set, get, _api);

export class AgentMemoryActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  clearTopicMemories = (topicId: string): void => {
    this.#set(
      { topicMemoriesMap: omit(this.#get().topicMemoriesMap, [topicId]) },
      false,
      n('clearTopicMemories', { topicId }),
    );
  };

  useFetchMemoriesForTopic = (topicId?: string | null): SWRResponse<RetrieveMemoryResult> => {
    return useClientDataSWRWithSync<RetrieveMemoryResult>(
      topicId ? ['useFetchMemoriesForTopic', topicId] : null,
      async () => {
        // Retrieve memories using topic's context
        // The backend will use topic info to build the query
        return await userMemoryService.retrieveMemoryForTopic(topicId!);
      },
      {
        onData: (data) => {
          if (!topicId || !data) return;

          this.#set(
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
    );
  };
}

export type AgentMemoryAction = Pick<AgentMemoryActionImpl, keyof AgentMemoryActionImpl>;
