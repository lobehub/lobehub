import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { type RetrieveMemoryResult } from '@/types/userMemory';

import { type UserMemoryStore } from '../../store';
import { clearUserReplicas } from '../../utils/replica';
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
   * Drop every topic bundle — memory and every persisted row of the identity,
   * including bundles an earlier session wrote in any workspace (the resource
   * is scoped per user, see `topicMemoriesResource`) — then refetch the mounted
   * topics. Called by `purgeAllMemories`, so a reload or a workspace switch can
   * never inject deleted memories into the next chat request.
   *
   * Memory is wiped synchronously. A storage failure (a blocked IndexedDB
   * upgrade, a closed connection) leaves a row behind that the next session has
   * no record of, so the purge is retried once and the outcome reported: the
   * caller surfaces `false` instead of claiming a purge a reload would undo.
   */
  internal_clearTopicMemories = async (user?: string): Promise<boolean> => {
    const active = user === undefined || user === topicMemoriesResource.scope.get();
    const cleared = await clearUserReplicas(user, this.#topicMemories);
    // The topic bundles sync under the replica's own keys, which the purge's
    // legacy-key revalidation does not reach.
    if (active) void this.#topicMemories.revalidate();
    return cleared;
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
