import { type KnowledgeItem } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import {
  arrayEntity,
  createReplicaSlice,
  recordLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { agentService } from '@/services/agent';
import { type StoreSetter } from '@/store/types';

import { type AgentStore } from '../../store';
import {
  agentKnowledgeListKey,
  type AgentKnowledgeListParams,
  agentKnowledgeListResource,
} from './projection';

/**
 * Knowledge Slice Actions
 * Handles knowledge base and file operations via the `agentKnowledgeList`
 * replica (read through `agentKnowledgeSelectors`).
 */

type Setter = StoreSetter<AgentStore>;

/** `useFetchFilesAndKnowledgeBases` result: replica flags plus the SWR-era aliases. */
export interface AgentKnowledgeSyncResult extends ReplicaSyncResult {
  /** A request is in flight and the surface has no rows to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Entry key the caller's rows live under (`agentKnowledgeMap[queryKey]`). */
  queryKey?: string;
}

export const createKnowledgeSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new KnowledgeSliceActionImpl(set, get, _api);

export class KnowledgeSliceActionImpl {
  readonly #get: () => AgentStore;
  readonly #knowledgeList;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#knowledgeList = createReplicaSlice(agentKnowledgeListResource, {
      actionPrefix: 'agentKnowledge',
      entity: arrayEntity<KnowledgeItem>((item) => item.id),
      fetcher: ({ agentId, visibility }) =>
        agentService.getFilesAndKnowledgeBases(agentId, visibility),
      get,
      // An unchanged response must not re-render the picker.
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'agentKnowledgeListReplica',
      view: recordLens<AgentStore, KnowledgeItem[]>('agentKnowledgeMap'),
    });
  }

  addFilesToAgent = async (fileIds: string[], enabled?: boolean): Promise<void> => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } =
      this.#get();
    if (!activeAgentId) return;
    if (fileIds.length === 0) return;

    await agentService.createAgentFiles(activeAgentId, fileIds, enabled);
    await internal_refreshAgentConfig(activeAgentId);
    await internal_refreshAgentKnowledge();
  };

  addKnowledgeBaseToAgent = async (knowledgeBaseId: string): Promise<void> => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } =
      this.#get();
    if (!activeAgentId) return;

    await agentService.createAgentKnowledgeBase(activeAgentId, knowledgeBaseId, true);
    await internal_refreshAgentConfig(activeAgentId);
    await internal_refreshAgentKnowledge();
  };

  internal_refreshAgentKnowledge = async (): Promise<void> => {
    // The picker keys its cache per visibility (unscoped/private/workspace), so
    // a mutation has to invalidate all three surfaces at once, otherwise
    // switching tab after add/remove still shows the stale list. A keyless
    // revalidate covers every loaded surface of the active scope.
    await this.#knowledgeList.revalidate();
  };

  removeFileFromAgent = async (fileId: string): Promise<void> => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } =
      this.#get();
    if (!activeAgentId) return;

    await agentService.deleteAgentFile(activeAgentId, fileId);
    await internal_refreshAgentConfig(activeAgentId);
    await internal_refreshAgentKnowledge();
  };

  removeKnowledgeBaseFromAgent = async (knowledgeBaseId: string): Promise<void> => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } =
      this.#get();
    if (!activeAgentId) return;

    await agentService.deleteAgentKnowledgeBase(activeAgentId, knowledgeBaseId);
    await internal_refreshAgentConfig(activeAgentId);
    await internal_refreshAgentKnowledge();
  };

  toggleFile = async (id: string, open?: boolean): Promise<void> => {
    const { activeAgentId, internal_refreshAgentConfig } = this.#get();
    if (!activeAgentId) return;

    await agentService.toggleFile(activeAgentId, id, open);
    await internal_refreshAgentConfig(activeAgentId);
  };

  toggleKnowledgeBase = async (id: string, open?: boolean): Promise<void> => {
    const { activeAgentId, internal_refreshAgentConfig } = this.#get();
    if (!activeAgentId) return;

    await agentService.toggleKnowledgeBase(activeAgentId, id, open);
    await internal_refreshAgentConfig(activeAgentId);
  };

  /**
   * Fetch orchestration for the knowledge picker. The rows land in
   * `agentKnowledgeMap[queryKey]` — read them through
   * `agentKnowledgeSelectors.getAgentKnowledgeList`.
   */
  useFetchFilesAndKnowledgeBases = (
    agentId?: string,
    visibility?: AgentKnowledgeListParams['visibility'],
  ): AgentKnowledgeSyncResult => {
    const params: AgentKnowledgeListParams | undefined = agentId
      ? { agentId, visibility }
      : undefined;
    const queryKey = params ? agentKnowledgeListKey(params) : undefined;
    const sync = this.#knowledgeList.useSync(params, { enabled: !!agentId });

    return {
      ...sync,
      // Loading only until the surface has rows to show: a revalidation over an
      // already-painted surface must not flash a skeleton.
      isLoading:
        !!queryKey &&
        !this.#get().agentKnowledgeMap[queryKey] &&
        (sync.isValidating || !sync.isHydrated),
      mutate: sync.revalidate,
      queryKey,
    };
  };
}

export type KnowledgeSliceAction = Pick<KnowledgeSliceActionImpl, keyof KnowledgeSliceActionImpl>;
