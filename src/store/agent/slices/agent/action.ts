import { isDesktop, randomAgentName } from '@lobechat/const';
import { type AgentContextDocument } from '@lobechat/context-engine';
import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';
import {
  applyWorkingDirByDevicePatch,
  isChatGroupSessionId,
  type LobeAgentAgencyConfig,
} from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { produce } from 'immer';
import type { SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { analyticsClient } from '@/libs/analytics/client';
import {
  createReplicaSlice,
  recordLens,
  type ReplicaSyncResult,
  revalidateReplica,
} from '@/libs/replica';
import { mutate, useClientDataSWR, useClientDataSWRWithSync } from '@/libs/swr';
import { agentConfigKeys, builtinAgentKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import type { AvailableAgentItem, CreateAgentParams, CreateAgentResult } from '@/services/agent';
import { agentService, AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT } from '@/services/agent';
import {
  type AgentDocumentListItem,
  agentDocumentService,
  agentDocumentSWRKeys,
  resolveAgentDocumentsContext,
} from '@/services/agentDocument';
import { aiAgentService } from '@/services/aiAgent';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
// Projection module only (no store import), so this does not cycle through the home store.
import { agentListResource } from '@/store/home/slices/agentList/projection';
import type { StoreSetter } from '@/store/types';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import type {
  AgentItem,
  LobeAgentChatConfig,
  LobeAgentConfig,
  RuntimeEnvConfig,
} from '@/types/agent';
import { merge } from '@/utils/merge';

import type { AgentStore } from '../../store';
import { heteroAgentDefaultName } from '../../utils/heteroAgentDefaultName';
import { setLocalAgentWorkingDirectory } from '../../utils/localAgentWorkingDirectoryStorage';
import type { AgentSliceState, LoadingState, SaveStatus } from './initialState';
import { agentConfigResource } from './projection';

export type AgentMetaUpdate = Partial<
  Pick<
    AgentItem,
    | 'avatar'
    | 'backgroundColor'
    | 'description'
    | 'marketIdentifier'
    | 'metadata'
    | 'name'
    | 'profile'
    | 'societyId'
    | 'tags'
    | 'title'
  >
>;
interface AgentConfigUpdateOptions {
  /** Propagate the persistence failure so a scoped editor can render failed + Retry. */
  rethrow?: boolean;
  /** Keep generic error messaging for ordinary config controls. @default true */
  showErrorMessage?: boolean;
}

interface AgentMetaUpdateOptions {
  /** Propagate persistence failure to an optimistic projection so it can roll back. */
  rethrow?: boolean;
}

/**
 * Deep-merge a partial config into the current one. `profile` is replaced as a
 * whole and per-device working directory selections are replaced atomically.
 * Returns `current` itself when nothing changed, so readers keep their reference.
 */
const mergeAgentConfig = (
  current: PartialDeep<AgentItem> | undefined,
  config: PartialDeep<LobeAgentConfig>,
  options?: { workingDirByDeviceSnapshot?: boolean },
): PartialDeep<AgentItem> => {
  const { value } = produce({ value: current ?? {} }, (draft) => {
    draft.value = merge(draft.value, config);
    // The character sheet is authored as one document — `AgentModel`
    // replaces it rather than merging — so mirror that here, or a trait the
    // user just cleared reappears until the next full fetch.
    if (Object.hasOwn(config, 'profile')) draft.value.profile = config.profile;
    const agencyConfig = draft.value.agencyConfig;
    if (agencyConfig && options?.workingDirByDeviceSnapshot) {
      // Complete server snapshots also remove device entries omitted by the server.
      agencyConfig.workingDirByDevice = config.agencyConfig?.workingDirByDevice;
    } else {
      applyWorkingDirByDevicePatch(
        agencyConfig,
        config.agencyConfig,
        Object.keys(config.agencyConfig?.workingDirByDevice ?? {}),
      );
    }
  });
  return current && isEqual(current, value) ? current : value;
};

/** `useFetchAgentConfig` result: replica sync flags plus the SWR-era aliases. */
export interface AgentConfigSyncResult extends ReplicaSyncResult {
  /** A request is in flight and there is nothing in `agentMap` to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
}

/**
 * Agent Slice Actions
 * Handles agent CRUD operations (config/meta updates)
 */

type Setter = StoreSetter<AgentStore>;
export const createAgentSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new AgentSliceActionImpl(set, get, _api);

export class AgentSliceActionImpl {
  readonly #get: () => AgentStore;
  readonly #set: Setter;
  readonly #pendingAgentDocuments = new Map<string, Promise<AgentContextDocument[] | undefined>>();
  readonly #updateAgentConfigControllers = new Map<string, AbortController>();
  readonly #updateAgentMetaControllers = new Map<string, AbortController>();
  readonly #config;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#config = createReplicaSlice(agentConfigResource, {
      actionPrefix: 'agentConfig',
      fetcher: async ({ agentId }) =>
        (await agentService.getAgentConfigById(agentId)) as LobeAgentConfig | null,
      get,
      // The endpoint returns a complete, authoritative profile: replace the
      // entry instead of patching it, so fields cleared on the server (e.g.
      // `editorData: null`) don't survive from an older local copy. `null`
      // (not found) is settled by the sync hooks; an unchanged profile keeps
      // its reference.
      merge: (incoming, confirmed) =>
        !incoming || isEqual(incoming, confirmed) ? undefined : incoming,
      set,
      stateKey: 'agentConfigReplica',
      view: recordLens<AgentStore, PartialDeep<AgentItem>>('agentMap'),
    });
  }

  /** Confirmed, persisted value of an agent's config. */
  #replaceConfirmedAgentConfig = (
    agentId: string,
    scope: string,
    data: PartialDeep<AgentItem>,
  ): void => {
    this.#config.replace({ agentId }, data as LobeAgentConfig, scope);
  };

  /** Fetch result of `useFetchAgentConfig` / `useHydrateAgentConfig`. */
  #settleAgentConfigFetch = (agentId: string, data: LobeAgentConfig | null): boolean => {
    // A successful fetch that resolves to null means the agent doesn't
    // exist or the caller lost access (e.g. a workspace agent switched
    // back to private) — a settled state, not "still loading".
    if (!data) {
      this.#markAgentNotFound(agentId);
      return false;
    }
    this.#clearAgentNotFound(agentId);
    return true;
  };

  #toAgentConfigSyncResult = (sync: ReplicaSyncResult, agentId: string): AgentConfigSyncResult => ({
    ...sync,
    isLoading: sync.isValidating && !this.#get().agentMap[agentId],
    mutate: sync.revalidate,
  });

  #createAgentScopedAbortController = (
    controllers: Map<string, AbortController>,
    agentId: string,
  ): AbortController => {
    controllers.get(agentId)?.abort(MESSAGE_CANCEL_FLAT);

    const controller = new AbortController();
    controllers.set(agentId, controller);
    return controller;
  };

  #syncAgentDocuments = (agentId: string, documents: AgentContextDocument[]) => {
    this.#set(
      (state) => ({
        agentDocumentsMap: {
          ...state.agentDocumentsMap,
          [agentId]: documents,
        },
      }),
      false,
      'syncAgentDocuments',
    );
  };

  appendStreamingSystemRole = (agentId: string, generation: number, chunk: string): void => {
    const {
      streamingSystemRole,
      streamingSystemRoleAgentId,
      streamingSystemRoleGeneration,
      streamingSystemRoleInProgress,
    } = this.#get();
    if (
      !streamingSystemRoleInProgress ||
      streamingSystemRoleAgentId !== agentId ||
      streamingSystemRoleGeneration !== generation
    )
      return;

    const currentContent = streamingSystemRole || '';
    this.#set({ streamingSystemRole: currentContent + chunk }, false, 'appendStreamingSystemRole');
  };

  createAgent = async (params: CreateAgentParams): Promise<CreateAgentResult> => {
    // Seed a default name so a new agent has an identity before the Agent
    // Builder conversation produces one; the builder may replace it later. This
    // lives here rather than in the create endpoint because the language only
    // resolves on the client (`auto` follows the browser). A caller that already
    // carries a name — e.g. a market agent — keeps it.
    //
    // A heterogeneous agent never draws a random personal name. In personal or
    // workspace-private scope its name is the product title; a shared workspace
    // agent adds the creator so members can distinguish identical tools.
    const heteroProvider = params.config?.agencyConfig?.heterogeneousProvider;
    const locale = globalGeneralSelectors.currentLanguage(useGlobalStore.getState());
    const config = {
      ...params.config,
      name:
        params.config?.name ||
        (heteroProvider
          ? heteroAgentDefaultName({
              productTitle: params.config?.title || getHeterogeneousTypeLabel(heteroProvider.type),
              visibility: params.visibility,
              workspaceId: getActiveWorkspaceId(),
            })
          : randomAgentName(locale)),
    };

    const result = await agentService.createAgent({ ...params, config });
    this.#get().invalidateAvailableAgents();

    const userId = userProfileSelectors.userId(getUserStoreState());

    void analyticsClient.track({
      name: 'new_agent_created',
      properties: {
        agent_id: result.agentId,
        assistant_name: params.config?.title || 'Untitled Agent',
        assistant_tags: params.config?.tags || [],
        user_id: userId || 'anonymous',
      },
    });

    return result;
  };

  finishStreamingSystemRole = async (agentId: string, generation: number): Promise<void> => {
    const { streamingSystemRoleAgentId, streamingSystemRoleGeneration } = this.#get();
    if (streamingSystemRoleAgentId !== agentId || streamingSystemRoleGeneration !== generation)
      return;

    // Persistence is handled by the invocation-scoped AgentManagerRuntime.
    // This singleton state only owns the visible typewriter animation, so a
    // superseded invocation must never clear the newer owner's buffer.
    this.#set(
      {
        streamingSystemRole: undefined,
        streamingSystemRoleAgentId: undefined,
        streamingSystemRoleInProgress: false,
      },
      false,
      'finishStreamingSystemRole',
    );
  };

  setActiveAgentId = (agentId?: string): void => {
    this.#set(
      (state) => (state.activeAgentId === agentId ? state : { activeAgentId: agentId }),
      false,
      'setActiveAgentId',
    );
  };

  setAgentPinned = (value: boolean | ((prev: boolean) => boolean)): void => {
    this.#set(
      (state) => ({
        isAgentPinned: typeof value === 'function' ? value(state.isAgentPinned) : value,
      }),
      false,
      'setAgentPinned',
    );
  };

  startStreamingSystemRole = (agentId: string): number => {
    const generation = (this.#get().streamingSystemRoleGeneration ?? 0) + 1;
    this.#set(
      {
        streamingSystemRole: '',
        streamingSystemRoleAgentId: agentId,
        streamingSystemRoleGeneration: generation,
        streamingSystemRoleInProgress: true,
      },
      false,
      'startStreamingSystemRole',
    );
    return generation;
  };

  toggleAgentPinned = (): void => {
    this.#set((state) => ({ isAgentPinned: !state.isAgentPinned }), false, 'toggleAgentPinned');
  };

  transferAgent = async (
    agentId: string,
    targetWorkspaceId: string | null,
    targetVisibility?: 'private' | 'public',
  ): Promise<{ agentId: string; slug: string | null; transferJobId: string | null }> => {
    return agentService.transferAgent(agentId, targetWorkspaceId, targetVisibility);
  };

  toggleAgentPlugin = async (pluginId: string, state?: boolean): Promise<void> => {
    const { activeAgentId, agentMap, updateAgentConfig } = this.#get();
    if (!activeAgentId) return;

    const currentPlugins = (agentMap[activeAgentId]?.plugins as string[]) || [];
    const hasPlugin = currentPlugins.includes(pluginId);

    // Determine new state
    const shouldEnable = state !== undefined ? state : !hasPlugin;

    let newPlugins: string[];
    if (shouldEnable && !hasPlugin) {
      newPlugins = [...currentPlugins, pluginId];
    } else if (!shouldEnable && hasPlugin) {
      newPlugins = currentPlugins.filter((id) => id !== pluginId);
    } else {
      // No change needed
      return;
    }

    await updateAgentConfig({ plugins: newPlugins });
  };

  updateAgentChatConfig = async (
    config: Partial<LobeAgentChatConfig>,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) return;

    await this.#get().updateAgentConfig({ chatConfig: config }, options);
  };

  updateAgentChatConfigById = async (
    agentId: string,
    config: Partial<LobeAgentChatConfig>,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    if (!agentId) return;

    await this.#get().updateAgentConfigById(agentId, { chatConfig: config }, options);
  };

  updateAgentConfig = async (
    config: PartialDeep<LobeAgentConfig>,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) return;

    await this.#get().updateAgentConfigById(activeAgentId, config, options);
  };

  updateAgentConfigById = async (
    agentId: string,
    config: PartialDeep<LobeAgentConfig>,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    if (!agentId) return;

    const controller = this.#createAgentScopedAbortController(
      this.#updateAgentConfigControllers,
      agentId,
    );

    try {
      await this.#get().optimisticUpdateAgentConfig(agentId, config, controller.signal, options);
    } finally {
      if (this.#updateAgentConfigControllers.get(agentId) === controller) {
        this.#updateAgentConfigControllers.delete(agentId);
      }
    }
  };

  updateAgentRuntimeEnvConfigById = async (
    agentId: string,
    config: Partial<RuntimeEnvConfig>,
  ): Promise<void> => {
    if (!agentId) return;

    if (isDesktop && 'workingDirectory' in config) {
      setLocalAgentWorkingDirectory(agentId, config.workingDirectory);
      const nextMap = { ...this.#get().localAgentWorkingDirectoryMap };
      if (config.workingDirectory) {
        nextMap[agentId] = config.workingDirectory;
      } else {
        delete nextMap[agentId];
      }
      this.#set({ localAgentWorkingDirectoryMap: nextMap }, false, 'updateAgentWorkingDirectory');
    }

    const restConfig = { ...config };
    delete restConfig.workingDirectory;
    if (Object.keys(restConfig).length > 0) {
      await this.#get().updateAgentChatConfigById(agentId, { runtimeEnv: restConfig });
    }
  };

  updateAgentMeta = async (meta: AgentMetaUpdate): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) return;

    await this.#get().updateAgentMetaById(activeAgentId, meta);
  };

  updateAgentMetaById = async (
    agentId: string,
    meta: AgentMetaUpdate,
    options?: AgentMetaUpdateOptions,
  ): Promise<void> => {
    if (!agentId) return;

    const controller = this.#createAgentScopedAbortController(
      this.#updateAgentMetaControllers,
      agentId,
    );

    try {
      await this.#get().optimisticUpdateAgentMeta(agentId, meta, controller.signal, options);
    } finally {
      if (this.#updateAgentMetaControllers.get(agentId) === controller) {
        this.#updateAgentMetaControllers.delete(agentId);
      }
    }
  };

  updateLoadingState = (key: keyof LoadingState, value: boolean): void => {
    this.#set(
      { loadingState: { ...this.#get().loadingState, [key]: value } },
      false,
      'updateLoadingState',
    );
  };

  updateSaveStatus = (status: SaveStatus): void => {
    this.#set(
      {
        lastUpdatedTime: status === 'saved' ? new Date() : this.#get().lastUpdatedTime,
        saveStatus: status,
      },
      false,
      'updateSaveStatus',
    );
  };

  useFetchAgentConfig = (isLogin: boolean | undefined, agentId: string): AgentConfigSyncResult => {
    const sync = this.#config.useSync(agentId ? { agentId } : null, {
      enabled: isLogin === true && !isChatGroupSessionId(agentId),
      onError: (error: any) => {
        this.#set(
          (state) => ({
            agentConfigErrorMap: {
              ...state.agentConfigErrorMap,
              [agentId]: error?.message || String(error),
            },
          }),
          false,
          'fetchAgentConfig/error',
        );
      },
      onSuccess: (data) => {
        if (!this.#settleAgentConfigFetch(agentId, data)) return;
        // Only adopt the fetched agent as the active one when nothing is
        // active yet. The active agent is owned by the route-level sync
        // (AgentIdSync on desktop/mobile, the popup pages' own setState).
        // A background or secondary config fetch — e.g. the inbox config
        // requested by the home input, a side-panel copilot, or another
        // open tab — must NOT hijack `activeAgentId` away from the routed
        // agent, which would otherwise flash the conversation header/welcome
        // back to the inbox ("Lobe AI") agent. A response of a previous scope
        // never lands in `agentMap`, so it adopts nothing either.
        if (!this.#get().activeAgentId && this.#get().agentMap[agentId]) {
          this.#set({ activeAgentId: data!.id }, false, 'fetchAgentConfig');
        }
        this.#clearAgentConfigError(agentId);
      },
    });

    return this.#toAgentConfigSyncResult(sync, agentId);
  };

  useFetchServerDefaultHeterogeneousCapability = (enabled: boolean) =>
    useClientDataSWR(enabled ? agentConfigKeys.serverDefaultHeterogeneousCapability() : null, () =>
      aiAgentService.getServerDefaultHeterogeneousCapability(),
    );

  /**
   * Re-trigger the agent config fetch after a failure. Clears the recorded
   * error first so consumers fall back to the loading skeleton, then
   * revalidates this agent's sync in the active scope.
   */
  retryAgentConfigFetch = async (agentId?: string): Promise<void> => {
    const id = agentId ?? this.#get().activeAgentId;
    if (!id) return;

    this.#clearAgentConfigError(id);

    await this.#config.revalidate(id);
  };

  /**
   * Warm an agent's config before navigation (sidebar hover). Skips agents
   * already in `agentMap`; the page's own sync revalidates them on mount.
   */
  prefetchAgentConfig = async (agentId: string): Promise<void> => {
    if (!agentId || this.#get().agentMap[agentId]) return;
    const scope = getCacheScope();
    const data = await agentService.getAgentConfigById(agentId);
    if (data) this.#replaceConfirmedAgentConfig(agentId, scope, data as LobeAgentConfig);
  };

  #markAgentNotFound = (agentId: string) => {
    const { agentNotFoundMap, agentMap } = this.#get();
    if (agentNotFoundMap[agentId] && !agentMap[agentId]) return;

    this.#set(
      (state) => ({ agentNotFoundMap: { ...state.agentNotFoundMap, [agentId]: true } }),
      false,
      'markAgentNotFound',
    );
    // Also drop the previously cached config (and its persisted row): surfaces
    // reading `agentMap` (title/avatar in the sidebar or header) must not keep
    // showing an agent the viewer lost access to next to the 404 content area.
    this.#config.remove(agentId);
  };

  #clearAgentNotFound = (agentId: string) => {
    if (!this.#get().agentNotFoundMap[agentId]) return;

    this.#set(
      (state) => {
        const next = { ...state.agentNotFoundMap };
        delete next[agentId];
        return { agentNotFoundMap: next };
      },
      false,
      'clearAgentNotFound',
    );
  };

  #clearAgentConfigError = (agentId: string) => {
    if (!this.#get().agentConfigErrorMap[agentId]) return;

    this.#set(
      (state) => {
        const next = { ...state.agentConfigErrorMap };
        delete next[agentId];
        return { agentConfigErrorMap: next };
      },
      false,
      'clearAgentConfigError',
    );
  };

  /** Like `useFetchAgentConfig`, but never touches `activeAgentId` or the error map. */
  useHydrateAgentConfig = (
    isLogin: boolean | undefined,
    agentId: string,
  ): AgentConfigSyncResult => {
    const sync = this.#config.useSync(agentId ? { agentId } : null, {
      enabled: isLogin === true && !isChatGroupSessionId(agentId),
      onSuccess: (data) => void this.#settleAgentConfigFetch(agentId, data),
    });

    return this.#toAgentConfigSyncResult(sync, agentId);
  };

  useFetchAgentDocuments = (agentId?: string | null): SWRResponse<AgentDocumentListItem[]> => {
    return useClientDataSWRWithSync<AgentDocumentListItem[]>(
      agentId ? agentDocumentSWRKeys.documentsList(agentId) : null,
      async () => agentDocumentService.listDocuments({ agentId: agentId! }),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useFetchAvailableAgents = (enabled: boolean): SWRResponse<AvailableAgentItem[]> => {
    return useClientDataSWRWithSync<AvailableAgentItem[]>(
      enabled ? agentConfigKeys.available() : null,
      () => agentService.queryAgents({ limit: AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT }),
      {
        onData: (data) => {
          this.#set({ availableAgents: data }, false, 'useFetchAvailableAgents');
        },
        revalidateOnFocus: false,
      },
    );
  };

  invalidateAvailableAgents = (): void => {
    this.#set({ availableAgents: undefined }, false, 'invalidateAvailableAgents');
    void mutate(agentConfigKeys.available());
  };

  ensureAgentDocuments = async (
    agentId?: string | null,
  ): Promise<AgentContextDocument[] | undefined> => {
    if (!agentId) return undefined;

    const cachedDocuments = this.#get().agentDocumentsMap[agentId];
    if (cachedDocuments !== undefined) return cachedDocuments;

    const pendingRequest = this.#pendingAgentDocuments.get(agentId);
    if (pendingRequest) return pendingRequest;

    const request = resolveAgentDocumentsContext({ agentId })
      .then((documents) => {
        if (documents) {
          this.#syncAgentDocuments(agentId, documents);
        }

        return documents;
      })
      .finally(() => {
        this.#pendingAgentDocuments.delete(agentId);
      });

    this.#pendingAgentDocuments.set(agentId, request);

    return request;
  };

  /**
   * Merge a partial config into `agentMap` (optimistic edits, configs other
   * stores already fetched). In-memory only: the persisted row holds confirmed
   * server values, written through `#replaceConfirmedAgentConfig`.
   */
  internal_dispatchAgentMap = (
    id: string,
    config: PartialDeep<LobeAgentConfig>,
    options?: { workingDirByDeviceSnapshot?: boolean },
  ): void => {
    this.#config.update(id, (current) => mergeAgentConfig(current, config, options), {
      persist: false,
    });
  };

  #mergeLatestAgencyConfigPatch = (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
  ): PartialDeep<LobeAgentConfig> => {
    const agencyConfigPatch = data.agencyConfig;
    if (!agencyConfigPatch) return data;

    const currentAgencyConfig = this.#get().agentMap[id]?.agencyConfig;
    const agencyConfig = merge(
      currentAgencyConfig ?? {},
      agencyConfigPatch,
    ) as PartialDeep<LobeAgentAgencyConfig>;

    // Keep the latest sibling config, but only send explicitly patched device
    // entries. Resending the whole map would overwrite another device's choice.
    delete agencyConfig.workingDirByDevice;
    if (Object.hasOwn(agencyConfigPatch, 'workingDirByDevice')) {
      agencyConfig.workingDirByDevice = agencyConfigPatch.workingDirByDevice;
    }

    return { ...data, agencyConfig };
  };

  optimisticUpdateAgentConfig = async (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    signal?: AbortSignal,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();
    const mergedData = this.#mergeLatestAgencyConfigPatch(id, data);
    const scope = getCacheScope();

    // 1. Optimistic update (instant UI feedback)
    internal_dispatchAgentMap(id, mergedData);
    updateSaveStatus('saving');

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentConfig(id, mergedData, signal);

      // 3. Apply returned data, then invalidate the SWR key for later subscribers.
      if (result?.success && result.agent) {
        internal_dispatchAgentMap(id, result.agent, { workingDirByDeviceSnapshot: true });
        const confirmed = this.#get().agentMap[id];
        if (confirmed) this.#replaceConfirmedAgentConfig(id, scope, confirmed);
        // Refresh agent:config so cached model A cannot replay after a
        // successful model A -> B update.
        await this.#get().internal_refreshAgentConfig(id, result.agent, scope);
        this.#get().invalidateAvailableAgents();
      }
      updateSaveStatus('saved');
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        updateSaveStatus('idle');
      } else {
        console.error('[AgentStore] Failed to save config:', error);
        updateSaveStatus('idle');
        // A swallowed failure reads as saved and surfaces later as mysterious
        // data loss (the next refetch reverts the optimistic value) — tell the
        // user right away.
        if (options?.showErrorMessage !== false) {
          toast.error(t('saveAgentConfigFail', { ns: 'common' }));
        }
        // Roll back only agencyConfig patches: those are discrete picks the
        // server actively validates (e.g. a workspace agent binding a
        // non-workspace device is rejected), so keeping the optimistic value
        // just shows a selection that never persisted. Other config fields keep
        // the optimistic value on purpose — refetching would clobber in-flight
        // form edits on a transient failure (see #16337).
        if (data.agencyConfig) await this.#get().internal_refreshAgentConfig(id, undefined, scope);
      }
      if (options?.rethrow) throw error;
    }
  };

  optimisticUpdateAgentMeta = async (
    id: string,
    meta: AgentMetaUpdate,
    signal?: AbortSignal,
    options?: AgentMetaUpdateOptions,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();
    const scope = getCacheScope();
    const previous = this.#get().agentMap[id];

    // 1. Optimistic update - meta fields are at the top level of agent config
    internal_dispatchAgentMap(id, meta as PartialDeep<LobeAgentConfig>);
    updateSaveStatus('saving');

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentMeta(id, meta, signal);
      if (scope !== getCacheScope()) return;

      // 3. Apply returned data, then seed related caches for later subscribers.
      if (result?.success && result.agent) {
        internal_dispatchAgentMap(id, result.agent, { workingDirByDeviceSnapshot: true });
        const confirmed = this.#get().agentMap[id];
        if (confirmed) this.#replaceConfirmedAgentConfig(id, scope, confirmed);
        await this.#get().internal_refreshAgentConfig(id, result.agent, scope);
        void revalidateReplica(agentListResource);
        this.#get().invalidateAvailableAgents();
      }
      updateSaveStatus('saved');
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        updateSaveStatus('idle');
      } else {
        console.error('[AgentStore] Failed to save meta:', error);
        updateSaveStatus('idle');
        if (options?.rethrow) {
          if (previous) this.#replaceConfirmedAgentConfig(id, scope, previous);
          else this.#config.update(id, () => undefined, { persist: false });
          throw error;
        }
      }
    }
  };

  internal_refreshAgentConfig = async (
    id: string,
    updatedAgent?: LobeAgentConfig,
    scope = getCacheScope(),
  ): Promise<void> => {
    /** Keep related agent and builtin-agent snapshots current after a successful edit. */
    const slugs = Object.entries(this.#get().builtinAgentIdMap)
      .filter(([, agentId]) => agentId === id)
      .map(([slug]) => slug);

    /**
     * Reuse the authoritative update response (the replica already holds it);
     * other mutations still need a network refresh.
     */
    if (updatedAgent) {
      await Promise.all(
        slugs.map((slug) =>
          mutate(builtinAgentKeys.init(slug, scope), updatedAgent as AgentItem, {
            revalidate: false,
          }),
        ),
      );
      return;
    }

    if (scope !== getCacheScope()) return;
    await Promise.all([
      this.#config.revalidate(id),
      ...slugs.map((slug) => this.#get().refreshBuiltinAgent(slug)),
    ]);
  };

  internal_createAbortController = (key: keyof AgentSliceState): AbortController => {
    const abortController = this.#get()[key] as AbortController;
    if (abortController) abortController.abort(MESSAGE_CANCEL_FLAT);
    const controller = new AbortController();
    this.#set({ [key]: controller }, false, 'internal_createAbortController');

    return controller;
  };
}

export type AgentSliceAction = Pick<AgentSliceActionImpl, keyof AgentSliceActionImpl>;
