import { cacheScope, type ReplicaSyncResult } from '@/libs/replica';
import type { AgentDocumentListItem } from '@/services/agentDocument';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type AgentDocumentState, initialState } from './initialState';
import { AgentDocumentPrivateAction } from './privateAction';
import { type AgentDocumentReaderParams } from './projection';
import { useAgentDocumentStore } from './store';

const n = setNamespace('agentDocument');

type Setter = StoreSetter<AgentDocumentState>;

type DocumentListEdit =
  | AgentDocumentListItem[]
  | ((prev: AgentDocumentListItem[] | undefined) => AgentDocumentListItem[] | undefined);

interface MutateDocumentListOptions {
  /** Re-sync from the server after the local edit. Defaults to `true`. */
  revalidate?: boolean;
}

interface UseFetchDocumentListOptions {
  /** Pause the sync (e.g. a panel hidden behind `<Activity>`). Defaults to `true`. */
  enabled?: boolean;
}

export class AgentDocumentActionImpl {
  readonly #get: () => AgentDocumentState;
  readonly #private: AgentDocumentPrivateAction;
  readonly #set: Setter;

  constructor(
    set: Setter,
    get: () => AgentDocumentState,
    privateAction: AgentDocumentPrivateAction,
  ) {
    this.#get = get;
    this.#set = set;
    this.#private = privateAction;
  }

  /**
   * Fetch orchestration for one agent's document list. Every consumer shares the
   * one entry, so mounting several of them costs one request. Read the rows with
   * `agentDocumentSelectors.getDocumentList`, not from the return value.
   */
  useFetchDocumentList = (
    agentId?: string | null,
    { enabled = true }: UseFetchDocumentListOptions = {},
  ): ReplicaSyncResult =>
    this.#private.list.useSync(agentId || null, { enabled, revalidateOnFocus: false });

  /**
   * Seed one agent's persisted list before anything mounts — the docs route
   * loader's pre-paint read, so the sidebar's first frame is the list rather
   * than its loading spinner. Resolves `true` when a persisted list landed.
   */
  preHydrateDocumentList = (agentId?: string | null): Promise<boolean> => {
    if (!agentId) return Promise.resolve(false);

    const scope = cacheScope.get();
    // The slot may still hold the previous identity's rows; drop them before seeding.
    this.#private.list.ensureScope(scope);
    return this.#private.list.hydrate(agentId, scope);
  };

  /**
   * Seed the reader's persisted body before the reader mounts — its route
   * loader's pre-paint read, so the first frame is the body rather than the
   * content spinner. Resolves `true` when a persisted body landed.
   */
  preHydrateReaderDocument = (params?: AgentDocumentReaderParams | null): Promise<boolean> => {
    if (!params?.agentId || !params.documentId) return Promise.resolve(false);

    const scope = cacheScope.get();
    this.#private.reader.ensureScope(scope);
    return this.#private.reader.hydrate(params, scope);
  };

  /** Fetch orchestration for the read-only reader; read it with `getReaderDocument`. */
  useFetchReaderDocument = (params?: AgentDocumentReaderParams | null): ReplicaSyncResult =>
    this.#private.reader.useSync(params?.agentId && params.documentId ? params : null, {
      revalidateOnFocus: false,
    });

  /**
   * The agent's list, loading it when no view has it yet (an entity link
   * clicked before the documents panel ever mounted). Joins a sync in flight.
   */
  fetchDocumentList = async (agentId: string): Promise<AgentDocumentListItem[] | undefined> => {
    const loaded = this.#get().agentDocumentListMap[agentId];
    if (loaded) return loaded;
    await this.#private.list.fetch(agentId);
    return this.#get().agentDocumentListMap[agentId];
  };

  /**
   * Re-sync one agent's list (or every loaded agent's). Writes go through the
   * agent-document service, which already refreshes this via the document
   * invalidation; this is for an explicit retry / refresh.
   */
  refreshDocumentList = async (agentId?: string): Promise<void> => {
    await this.#private.list.revalidate(agentId);
  };

  /**
   * Edit one agent's list on the client — an optimistic insert / rename / move /
   * delete or its rollback — then (unless `revalidate: false`) re-sync it. With
   * no edit it only re-syncs. The edit stays in memory: only a server answer is
   * persisted, so a reload never paints a write the server did not confirm.
   */
  mutateDocumentList = async (
    agentId: string,
    edit?: DocumentListEdit,
    { revalidate = true }: MutateDocumentListOptions = {},
  ): Promise<void> => {
    if (edit !== undefined) {
      this.#private.list.update(
        agentId,
        (prev) => (typeof edit === 'function' ? edit(prev) : edit),
        { persist: false },
      );
    }
    if (edit === undefined || revalidate) await this.#private.list.revalidate(agentId);
  };

  reset = (): void => {
    this.#set(initialState, false, n('reset'));
  };
}

const { getState, setState } = useAgentDocumentStore;

export const agentDocumentActions = new AgentDocumentActionImpl(
  setState,
  getState,
  new AgentDocumentPrivateAction(setState, getState),
);
