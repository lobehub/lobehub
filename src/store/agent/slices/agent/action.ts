import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { type SWRResponse } from 'swr';
import { type PartialDeep } from 'type-fest';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { type CreateAgentParams, type CreateAgentResult } from '@/services/agent';
import { agentService } from '@/services/agent';
import { type StoreSetter } from '@/store/types';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import {
  type LobeAgentChatConfig,
  type LobeAgentConfig,
  type LocalSystemConfig,
} from '@/types/agent';
import { type MetaData } from '@/types/meta';
import { merge } from '@/utils/merge';

import { type AgentStore } from '../../store';
import { type AgentSliceState, type LoadingState, type SaveStatus } from './initialState';

const FETCH_AGENT_CONFIG_KEY = 'FETCH_AGENT_CONFIG';

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

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  appendStreamingSystemRole = (chunk: string): void => {
    const currentContent = this.#get().streamingSystemRole || '';
    this.#set({ streamingSystemRole: currentContent + chunk }, false, 'appendStreamingSystemRole');
  };

  createAgent = async (params: CreateAgentParams): Promise<CreateAgentResult> => {
    const result = await agentService.createAgent(params);

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
          session_id: result.sessionId,
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

  updateAgentLocalSystemConfigById = async (
    agentId: string,
    config: Partial<LocalSystemConfig>,
  ): Promise<void> => {
    if (!agentId) return;

    await this.#get().updateAgentChatConfigById(agentId, { localSystem: config });
  };

  updateAgentMeta = async (meta: Partial<MetaData>): Promise<void> => {
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
    return useClientDataSWR<LobeAgentConfig>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true && agentId && !agentId.startsWith('cg_')
        ? ([FETCH_AGENT_CONFIG_KEY, agentId] as const)
        : null,
      async ([, id]: readonly [string, string]) => {
        const data = await agentService.getAgentConfigById(id);
        return data as LobeAgentConfig;
      },
      {
        onSuccess: (data) => {
          this.#get().internal_dispatchAgentMap(agentId, data);

          this.#set({ activeAgentId: data.id }, false, 'fetchAgentConfig');
        },
      },
    );
  };

  internal_dispatchAgentMap = (id: string, config: PartialDeep<LobeAgentConfig>): void => {
    const agentMap = produce(this.#get().agentMap, (draft) => {
      if (!draft[id]) {
        draft[id] = config;
      } else {
        draft[id] = merge(draft[id], config);
      }
    });

    if (isEqual(this.#get().agentMap, agentMap)) return;

    this.#set({ agentMap }, false, 'dispatchAgentMap');
  };

  optimisticUpdateAgentConfig = async (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    signal?: AbortSignal,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();

    // 1. Optimistic update (instant UI feedback)
    internal_dispatchAgentMap(id, data);
    updateSaveStatus('saving');

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentConfig(id, data, signal);

      // 3. Use returned data directly (no refetch needed!)
      if (result?.success && result.agent) {
        internal_dispatchAgentMap(id, result.agent);
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
    meta: Partial<MetaData>,
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
    await mutate([FETCH_AGENT_CONFIG_KEY, id]);
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
