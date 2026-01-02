import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import type { SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';
import { type StateCreator } from 'zustand/vanilla';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { type CreateAgentParams, type CreateAgentResult, agentService } from '@/services/agent';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { type LobeAgentChatConfig, type LobeAgentConfig } from '@/types/agent';
import { type MetaData } from '@/types/meta';
import { merge } from '@/utils/merge';

import type { AgentStore } from '../../store';
import { type AgentSliceState, type LoadingState, type SaveStatus } from './initialState';

const FETCH_AGENT_CONFIG_KEY = 'FETCH_AGENT_CONFIG';

/**
 * Agent Slice Actions
 * Handles agent CRUD operations (config/meta updates)
 */
export interface AgentSliceAction {
  /**
   * Append content chunk to streaming system role
   */
  appendStreamingSystemRole: (chunk: string) => void;
  /**
   * Create a new agent with session
   * @returns Created agent result with agentId and sessionId
   */
  createAgent: (params: CreateAgentParams) => Promise<CreateAgentResult>;
  /**
   * Finish streaming and save final content to agent config
   */
  finishStreamingSystemRole: (agentId: string) => Promise<void>;
  internal_createAbortController: (key: keyof AgentSliceState) => AbortController;
  internal_dispatchAgentMap: (id: string, config: PartialDeep<LobeAgentConfig>) => void;
  internal_refreshAgentConfig: (id: string) => Promise<void>;
  optimisticUpdateAgentConfig: (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    signal?: AbortSignal,
  ) => Promise<void>;
  optimisticUpdateAgentMeta: (
    id: string,
    meta: Partial<MetaData>,
    signal?: AbortSignal,
  ) => Promise<void>;
  /**
   * Update current active agent id
   */
  setActiveAgentId: (agentId?: string) => void;
  /**
   * Set the agent panel pinned state
   */
  setAgentPinned: (pinned: boolean | ((prev: boolean) => boolean)) => void;
  /**
   * Start streaming system role update
   */
  startStreamingSystemRole: () => void;
  /**
   * Toggle the agent panel pinned state
   */
  toggleAgentPinned: () => void;
  /**
   * Toggle a plugin for the current agent
   * @param pluginId - The plugin identifier
   * @param state - Optional explicit state (true = enable, false = disable). If not provided, toggles.
   */
  toggleAgentPlugin: (pluginId: string, state?: boolean) => Promise<void>;
  updateAgentChatConfig: (config: Partial<LobeAgentChatConfig>) => Promise<void>;
  updateAgentChatConfigById: (
    agentId: string,
    config: Partial<LobeAgentChatConfig>,
  ) => Promise<void>;
  updateAgentConfig: (config: PartialDeep<LobeAgentConfig>) => Promise<void>;
  updateAgentConfigById: (agentId: string, config: PartialDeep<LobeAgentConfig>) => Promise<void>;
  updateAgentMeta: (meta: Partial<MetaData>) => Promise<void>;
  /**
   * Update loading state for meta fields (used during autocomplete)
   */
  updateLoadingState: (key: keyof LoadingState, value: boolean) => void;
  /**
   * Update save status for showing auto-save hint
   */
  updateSaveStatus: (status: SaveStatus) => void;
  useFetchAgentConfig: (isLogin: boolean | undefined, id: string) => SWRResponse<LobeAgentConfig>;
}

export const createAgentSlice: StateCreator<
  AgentStore,
  [['zustand/devtools', never]],
  [],
  AgentSliceAction
> = (set, get) => ({
  appendStreamingSystemRole: (chunk) => {
    const currentContent = get().streamingSystemRole || '';
    set({ streamingSystemRole: currentContent + chunk }, false, 'appendStreamingSystemRole');
  },

  createAgent: async (params) => {
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
  },

  finishStreamingSystemRole: async (agentId) => {
    const { streamingSystemRole } = get();

    if (!streamingSystemRole) {
      set({ streamingSystemRoleInProgress: false }, false, 'finishStreamingSystemRole');
      return;
    }

    // Save the final content to agent config
    await get().optimisticUpdateAgentConfig(agentId, {
      systemRole: streamingSystemRole,
    });

    // Reset streaming state
    set(
      {
        streamingSystemRole: undefined,
        streamingSystemRoleInProgress: false,
      },
      false,
      'finishStreamingSystemRole',
    );
  },

  setActiveAgentId: (agentId) => {
    set(
      (state) => (state.activeAgentId === agentId ? state : { activeAgentId: agentId }),
      false,
      'setActiveAgentId',
    );
  },

  setAgentPinned: (value) => {
    set(
      (state) => ({
        isAgentPinned: typeof value === 'function' ? value(state.isAgentPinned) : value,
      }),
      false,
      'setAgentPinned',
    );
  },

  startStreamingSystemRole: () => {
    set(
      {
        streamingSystemRole: '',
        streamingSystemRoleInProgress: true,
      },
      false,
      'startStreamingSystemRole',
    );
  },

  toggleAgentPinned: () => {
    set((state) => ({ isAgentPinned: !state.isAgentPinned }), false, 'toggleAgentPinned');
  },

  toggleAgentPlugin: async (pluginId, state) => {
    const { activeAgentId, agentMap, updateAgentConfig } = get();
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
  },

  updateAgentChatConfig: async (config) => {
    const { activeAgentId } = get();

    if (!activeAgentId) return;

    await get().updateAgentConfig({ chatConfig: config });
  },

  updateAgentChatConfigById: async (agentId, config) => {
    if (!agentId) return;

    await get().updateAgentConfigById(agentId, { chatConfig: config });
  },

  updateAgentConfig: async (config) => {
    const { activeAgentId } = get();

    if (!activeAgentId) return;

    const controller = get().internal_createAbortController('updateAgentConfigSignal');

    await get().optimisticUpdateAgentConfig(activeAgentId, config, controller.signal);
  },

  updateAgentConfigById: async (agentId, config) => {
    if (!agentId) return;

    const controller = get().internal_createAbortController('updateAgentConfigSignal');

    await get().optimisticUpdateAgentConfig(agentId, config, controller.signal);
  },

  updateAgentMeta: async (meta) => {
    const { activeAgentId } = get();

    if (!activeAgentId) return;

    const controller = get().internal_createAbortController('updateAgentMetaSignal');

    await get().optimisticUpdateAgentMeta(activeAgentId, meta, controller.signal);
  },

  updateLoadingState: (key, value) => {
    set({ loadingState: { ...get().loadingState, [key]: value } }, false, 'updateLoadingState');
  },

  updateSaveStatus: (status) => {
    set(
      {
        lastUpdatedTime: status === 'saved' ? new Date() : get().lastUpdatedTime,
        saveStatus: status,
      },
      false,
      'updateSaveStatus',
    );
  },

  useFetchAgentConfig: (isLogin, agentId) =>
    useClientDataSWR<LobeAgentConfig>(
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
          get().internal_dispatchAgentMap(agentId, data);

          set({ activeAgentId: data.id }, false, 'fetchAgentConfig');
        },
      },
    ),

  /* eslint-disable sort-keys-fix/sort-keys-fix */

  internal_dispatchAgentMap: (id, config) => {
    const agentMap = produce(get().agentMap, (draft) => {
      if (!draft[id]) {
        draft[id] = config;
      } else {
        draft[id] = merge(draft[id], config);
      }
    });

    if (isEqual(get().agentMap, agentMap)) return;

    set({ agentMap }, false, 'dispatchAgentMap');
  },

  optimisticUpdateAgentConfig: async (id, data, signal) => {
    const { internal_dispatchAgentMap, updateSaveStatus } = get();

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
  },

  optimisticUpdateAgentMeta: async (id, meta, signal) => {
    const { internal_dispatchAgentMap, updateSaveStatus } = get();

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
  },

  internal_refreshAgentConfig: async (id) => {
    await mutate([FETCH_AGENT_CONFIG_KEY, id]);
  },

  internal_createAbortController: (key) => {
    const abortController = get()[key] as AbortController;
    if (abortController) abortController.abort(MESSAGE_CANCEL_FLAT);
    const controller = new AbortController();
    set({ [key]: controller }, false, 'internal_createAbortController');

    return controller;
  },
});
