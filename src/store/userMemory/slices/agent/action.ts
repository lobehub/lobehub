import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { type RetrieveMemoryResult } from '@/types/userMemory';

import { type UserMemoryStore } from '../../store';
import { topicMemoriesResource } from './projection';

type Setter = StoreSetter<UserMemoryStore>;
export const createAgentMemorySlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new AgentMemoryActionImpl(set, get, _api);

export class AgentMemoryActionImpl {
  /**
   * Topic-based memory bundles, keyed by topic id — the replica view the chat
   * send path reads synchronously (see `resolveTopicMemories`).
   */
  readonly #topicMemories;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#topicMemories = createReplicaSlice(topicMemoriesResource, {
      actionPrefix: 'userMemory/topicMemories',
      fetcher: (topicId) => userMemoryService.retrieveMemoryForTopic(topicId),
      get,
      set,
      stateKey: 'topicMemoriesReplica',
      view: recordLens<UserMemoryStore, RetrieveMemoryResult>('topicMemoriesMap'),
    });
  }

  /** Drop one topic's cached bundle (and its replica bookkeeping entry). */
  clearTopicMemories = (topicId: string): void => {
    this.#topicMemories.remove(topicId);
  };

  /**
   * Fetch orchestration only; read the bundle through `agentMemorySelectors`.
   * One replica entry per topic, so switching topics paints the persisted
   * bundle and the network only confirms it.
   */
  useFetchMemoriesForTopic = (topicId?: string | null): ReplicaSyncResult =>
    this.#topicMemories.useSync(topicId ?? null, { revalidateOnFocus: false });
}

export type AgentMemoryAction = Pick<AgentMemoryActionImpl, keyof AgentMemoryActionImpl>;
