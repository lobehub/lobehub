import { isDesktop } from '@lobechat/const';
import { type AgentContextDocument } from '@lobechat/context-engine';
import {
  isChatGroupSessionId,
  type LobeAgentAgencyConfig,
  pruneWorkingDirByDeviceDeletes,
} from '@lobechat/types';
import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import type { SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { agentConfigKeys } from '@/libs/swr/keys';
import type { AvailableAgentItem, CreateAgentParams, CreateAgentResult } from '@/services/agent';
import { agentService, AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT } from '@/services/agent';
import {
  type AgentDocumentListItem,
  agentDocumentService,
  agentDocumentSWRKeys,
  resolveAgentDocumentsContext,
} from '@/services/agentDocument';
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
import { setLocalAgentWorkingDirectory } from '../../utils/localAgentWorkingDirectoryStorage';
import type { AgentSliceState, LoadingState, SaveStatus } from './initialState';

type AgentMetaUpdate = Partial<
  Pick<
    AgentItem,
    'avatar' | 'backgroundColor' | 'description' | 'marketIdentifier' | 'tags' | 'title'
  >
>;
type AgencyConfigPatch = PartialDeep<LobeAgentAgencyConfig>;

const preserveWorkingDirDeleteMarkers = (
  merged: LobeAgentAgencyConfig,
  patch: AgencyConfigPatch,
): void => {
  const incoming = patch.workingDirByDevice;
  if (!incoming) return;

  const deletions = Object.keys(incoming).filter((key) => incoming[key] === undefined);
  if (deletions.length === 0) return;

  const workingDirByDevice = {
    ...merged.workingDirByDevice,
  } as Record<string, string | undefined>;

  for (const key of deletions) {
    workingDirByDevice[key] = undefined;
  }

  merged.workingDirByDevice = workingDirByDevice as Record<string, string>;
};

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

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

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

  appendStreamingSystemRole = (chunk: string): void => {
    const currentContent = this.#get().streamingSystemRole || '';
    this.#set({ streamingSystemRole: currentContent + chunk }, false, 'appendStreamingSystemRole');
  };

  createAgent = async (params: CreateAgentParams): Promise<CreateAgentResult> => {
    const result = await agentService.createAgent(params);
    this.#get().invalidateAvailableAgents();

    // Track new agent creation analytics
    const analytics = getSingletonAnalyticsOptional();
    if (analytics) {
      const userStore = getUserStoreState();
      const userId = userProfileSelectors.userId(userStore);

      analytics.track({
        name: 'new_agent_created',
        properties: {
          agent_id: result.agentId,
          assistant_name: params.config?.title || 'Untitled Agent',
          assistant_tags: params.config?.tags || [],
          user_id: userId || 'anonymous',
        },
      });
    }

    return result;
  };

  finishStreamingSystemRole = async (agentId: string): Promise<void> => {
    const { streamingSystemRole } = this.#get();

    if (!streamingSystemRole) {
      this.#set({ streamingSystemRoleInProgress: false }, false, 'finishStreamingSystemRole');
      return;
    }

    // Save the final content to agent config
    await this.#get().optimisticUpdateAgentConfig(agentId, {
      systemRole: streamingSystemRole,
    });

    // Reset streaming state
    this.#set(
      {
        streamingSystemRole: undefined,
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

  startStreamingSystemRole = (): void => {
    this.#set(
      {
        streamingSystemRole: '',
        streamingSystemRoleInProgress: true,
      },
      false,
      'startStreamingSystemRole',
    );
  };

  toggleAgentPinned = (): void => {
    this.#set((state) => ({ isAgentPinned: !state.isAgentPinned }), false, 'toggleAgentPinned');
  };

  transferAgent = async (
    agentId: string,
    targetWorkspaceId: string | null,
  ): Promise<{ agentId: string; slug: string | null }> => {
    return agentService.transferAgent(agentId, targetWorkspaceId);
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

  updateAgentChatConfig = async (config: Partial<LobeAgentChatConfig>): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) return;

    await this.#get().updateAgentConfig({ chatConfig: config });
  };

  updateAgentChatConfigById = async (
    agentId: string,
    config: Partial<LobeAgentChatConfig>,
  ): Promise<void> => {
    if (!agentId) return;

    await this.#get().updateAgentConfigById(agentId, { chatConfig: config });
  };

  updateAgentConfig = async (config: PartialDeep<LobeAgentConfig>): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) return;

    const controller = this.#get().internal_createAbortController('updateAgentConfigSignal');

    await this.#get().optimisticUpdateAgentConfig(activeAgentId, config, controller.signal);
  };

  updateAgentConfigById = async (
    agentId: string,
    config: PartialDeep<LobeAgentConfig>,
  ): Promise<void> => {
    if (!agentId) return;

    const controller = this.#get().internal_createAbortController('updateAgentConfigSignal');

    await this.#get().optimisticUpdateAgentConfig(agentId, config, controller.signal);
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

    const controller = this.#get().internal_createAbortController('updateAgentMetaSignal');

    await this.#get().optimisticUpdateAgentMeta(activeAgentId, meta, controller.signal);
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

  useFetchAgentConfig = (
    isLogin: boolean | undefined,
    agentId: string,
  ): SWRResponse<LobeAgentConfig> => {
    const swrKey =
      isLogin === true && agentId && !isChatGroupSessionId(agentId)
        ? agentConfigKeys.config(agentId)
        : null;

    return useClientDataSWRWithSync<LobeAgentConfig>(
      swrKey,
      async () => {
        const data = await agentService.getAgentConfigById(agentId);
        return data as LobeAgentConfig;
      },
      {
        onData: (data) => {
          if (!data) return;
          this.#get().internal_dispatchAgentMap(agentId, data);
          // Only adopt the fetched agent as the active one when nothing is
          // active yet. The active agent is owned by the route-level sync
          // (AgentIdSync on desktop/mobile, the popup pages' own setState).
          // A background or secondary config fetch — e.g. the inbox config
          // requested by the home input, a side-panel copilot, or another
          // open tab — must NOT hijack `activeAgentId` away from the routed
          // agent, which would otherwise flash the conversation header/welcome
          // back to the inbox ("Lobe AI") agent.
          if (!this.#get().activeAgentId) {
            this.#set({ activeAgentId: data.id }, false, 'fetchAgentConfig');
          }
          this.#clearAgentConfigError(agentId);
        },
        onError: (error) => {
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
      },
    );
  };

  /**
   * Re-trigger the agent config fetch after a failure. Clears the recorded
   * error first so consumers fall back to the loading skeleton, then
   * revalidates every SWR entry for this agent (keys may carry a workspace
   * suffix, hence the filter form).
   */
  retryAgentConfigFetch = async (agentId?: string): Promise<void> => {
    const id = agentId ?? this.#get().activeAgentId;
    if (!id) return;

    this.#clearAgentConfigError(id);

    await mutate(
      (key) => Array.isArray(key) && key[0] === agentConfigKeys.config.root && key[1] === id,
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

  useHydrateAgentConfig = (
    isLogin: boolean | undefined,
    agentId: string,
  ): SWRResponse<LobeAgentConfig> => {
    const swrKey =
      isLogin === true && agentId && !isChatGroupSessionId(agentId)
        ? agentConfigKeys.config(agentId)
        : null;

    return useClientDataSWRWithSync<LobeAgentConfig>(
      swrKey,
      async () => {
        const data = await agentService.getAgentConfigById(agentId);
        return data as LobeAgentConfig;
      },
      {
        onData: (data) => {
          if (!data) return;
          this.#get().internal_dispatchAgentMap(agentId, data);
        },
      },
    );
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

  internal_dispatchAgentMap = (id: string, config: PartialDeep<LobeAgentConfig>): void => {
    const agentMap = produce(this.#get().agentMap, (draft) => {
      if (!draft[id]) {
        draft[id] = config;
      } else {
        draft[id] = merge(draft[id], config);
        // merge() can't drop keys; honor `undefined` as a per-device delete so
        // clearing a working directory takes effect optimistically.
        pruneWorkingDirByDeviceDeletes(draft[id].agencyConfig, config.agencyConfig);
      }
    });

    if (isEqual(this.#get().agentMap, agentMap)) return;

    this.#set({ agentMap }, false, 'dispatchAgentMap');
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
    ) as LobeAgentAgencyConfig;

    pruneWorkingDirByDeviceDeletes(agencyConfig, agencyConfigPatch);
    preserveWorkingDirDeleteMarkers(agencyConfig, agencyConfigPatch);

    return { ...data, agencyConfig };
  };

  optimisticUpdateAgentConfig = async (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    signal?: AbortSignal,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();
    const mergedData = this.#mergeLatestAgencyConfigPatch(id, data);

    // 1. Optimistic update (instant UI feedback)
    internal_dispatchAgentMap(id, mergedData);
    updateSaveStatus('saving');

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentConfig(id, mergedData, signal);

      // 3. Apply returned data, then invalidate the SWR key for later subscribers.
      if (result?.success && result.agent) {
        internal_dispatchAgentMap(id, result.agent);
        // Refresh agent:config so cached model A cannot replay after a
        // successful model A -> B update.
        await this.#get().internal_refreshAgentConfig(id);
        this.#get().invalidateAvailableAgents();
      }
      updateSaveStatus('saved');
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        updateSaveStatus('idle');
      } else {
        console.error('[AgentStore] Failed to save config:', error);
        updateSaveStatus('idle');
      }
    }
  };

  optimisticUpdateAgentMeta = async (
    id: string,
    meta: AgentMetaUpdate,
    signal?: AbortSignal,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();

    // 1. Optimistic update - meta fields are at the top level of agent config
    internal_dispatchAgentMap(id, meta as PartialDeep<LobeAgentConfig>);
    updateSaveStatus('saving');

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentMeta(id, meta, signal);

      // 3. Use returned data directly (no refetch needed!)
      if (result?.success && result.agent) {
        internal_dispatchAgentMap(id, result.agent);
        this.#get().invalidateAvailableAgents();
      }
      updateSaveStatus('saved');
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        updateSaveStatus('idle');
      } else {
        console.error('[AgentStore] Failed to save meta:', error);
        updateSaveStatus('idle');
      }
    }
  };

  internal_refreshAgentConfig = async (id: string): Promise<void> => {
    await mutate(agentConfigKeys.config(id));
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
