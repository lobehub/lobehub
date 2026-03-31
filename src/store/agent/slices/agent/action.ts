import { isChatGroupSessionId } from '@lobechat/types';
import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import type { SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { mutate, useClientDataSWR } from '@/libs/swr';
import type { CreateAgentParams, CreateAgentResult } from '@/services/agent';
import { agentService } from '@/services/agent';
import type { StoreSetter } from '@/store/types';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import type { LobeAgentChatConfig, LobeAgentConfig, RuntimeEnvConfig } from '@/types/agent';
import type { MetaData } from '@/types/meta';
import { merge } from '@/utils/merge';

import type { AgentStore } from '../../store';
import type { AgentSliceState, LoadingState, SaveStatus } from './initialState';

const FETCH_AGENT_CONFIG_KEY = 'FETCH_AGENT_CONFIG';

type ThinkingLevelVariantKey =
  | 'thinkingLevel2'
  | 'thinkingLevel3'
  | 'thinkingLevel4'
  | 'thinkingLevel5';

const THINKING_LEVEL_VARIANT_LEVELS = {
  thinkingLevel2: ['low', 'high'],
  thinkingLevel3: ['low', 'medium', 'high'],
  thinkingLevel4: ['minimal', 'high'],
  thinkingLevel5: ['minimal', 'low', 'medium', 'high'],
} as const satisfies Record<ThinkingLevelVariantKey, readonly string[]>;

const THINKING_LEVEL_VARIANTS = [
  'thinkingLevel5',
  'thinkingLevel4',
  'thinkingLevel3',
  'thinkingLevel2',
] as const satisfies readonly ThinkingLevelVariantKey[];

const normalizeModelId = (id: string) => id.trim().toLowerCase();

interface ExtendParamsLookup {
  byId: Map<string, string[]>;
  byProviderAndId: Map<string, string[]>;
}

let extendParamsLookupPromise: Promise<ExtendParamsLookup> | undefined;

const getModelExtendParams = (model: unknown): string[] | undefined => {
  const extendParams = (model as { settings?: { extendParams?: unknown } })?.settings?.extendParams;
  if (!Array.isArray(extendParams) || extendParams.length === 0) return undefined;

  const stringParams = extendParams.filter((item): item is string => typeof item === 'string');
  if (stringParams.length === 0) return undefined;

  return stringParams;
};

const getExtendParamsLookup = async (): Promise<ExtendParamsLookup> => {
  if (!extendParamsLookupPromise) {
    extendParamsLookupPromise = import('model-bank').then(({ LOBE_DEFAULT_MODEL_LIST }) => {
      const byId = new Map<string, string[]>();
      const byProviderAndId = new Map<string, string[]>();

      for (const model of LOBE_DEFAULT_MODEL_LIST) {
        const extendParams = getModelExtendParams(model);
        if (!extendParams) continue;

        const normalizedId = normalizeModelId(model.id);
        const normalizedIdDash = normalizedId.replaceAll('.', '-');

        byId.set(normalizedId, extendParams);
        byId.set(normalizedIdDash, extendParams);

        byProviderAndId.set(`${model.providerId}:${normalizedId}`, extendParams);
        byProviderAndId.set(`${model.providerId}:${normalizedIdDash}`, extendParams);
      }

      return { byId, byProviderAndId };
    });
  }

  return extendParamsLookupPromise;
};

const stripProviderPrefix = (id: string) => {
  if (!id.includes('/')) return id;
  return id.split('/').at(-1) || id;
};

const buildModelCandidates = (model: string) => {
  const candidates = new Set<string>();

  const addCandidate = (value?: string) => {
    if (!value) return;
    const normalized = normalizeModelId(value);
    if (!normalized) return;

    candidates.add(normalized);
    candidates.add(normalized.replaceAll('.', '-'));
  };

  addCandidate(model);
  addCandidate(stripProviderPrefix(model));

  return [...candidates];
};

const resolveModelExtendParams = async (
  model: string,
  provider?: string,
): Promise<string[] | undefined> => {
  const lookup = await getExtendParamsLookup();
  const candidates = buildModelCandidates(model);

  if (provider) {
    for (const candidate of candidates) {
      const extendParams = lookup.byProviderAndId.get(`${provider}:${candidate}`);
      if (extendParams) return extendParams;
    }
  }

  for (const candidate of candidates) {
    const extendParams = lookup.byId.get(candidate);
    if (extendParams) return extendParams;
  }

  return undefined;
};

const pickThinkingLevelVariantKey = (
  extendParams?: string[],
): ThinkingLevelVariantKey | undefined =>
  THINKING_LEVEL_VARIANTS.find((key) => !!extendParams?.includes(key));

const legacyThinkingLevelMigrationInFlight = new Set<string>();

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

  updateAgentRuntimeEnvConfigById = async (
    agentId: string,
    config: Partial<RuntimeEnvConfig>,
  ): Promise<void> => {
    if (!agentId) return;

    await this.#get().updateAgentChatConfigById(agentId, { runtimeEnv: config });
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
      isLogin === true && agentId && !isChatGroupSessionId(agentId)
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

          // Migrate legacy Gemini thinking level config for upgraded agents:
          // older configs stored only `thinkingLevel`, while newer models use thinkingLevel2/3/4/5.
          const chatConfig = data.chatConfig || {};
          const modelId = normalizeModelId(stripProviderPrefix(data.model));
          const hasVariantKey = THINKING_LEVEL_VARIANTS.some(
            (key) => typeof (chatConfig as any)[key] === 'string',
          );

          if (
            data.provider === 'google' &&
            modelId.includes('gemini-3') &&
            typeof chatConfig.thinkingLevel === 'string' &&
            !hasVariantKey
          ) {
            void this.#get().internal_migrateLegacyThinkingLevel(agentId, data);
          }
        },
      },
    );
  };

  internal_migrateLegacyThinkingLevel = async (
    agentId: string,
    config: LobeAgentConfig,
  ): Promise<void> => {
    if (legacyThinkingLevelMigrationInFlight.has(agentId)) return;
    legacyThinkingLevelMigrationInFlight.add(agentId);

    try {
      if (config.provider !== 'google') return;

      const modelId = normalizeModelId(stripProviderPrefix(config.model));
      if (!modelId.includes('gemini-3')) return;

      const fetchedChatConfig = config.chatConfig || {};
      const fetchedLegacyThinkingLevel = fetchedChatConfig.thinkingLevel;
      if (!fetchedLegacyThinkingLevel || typeof fetchedLegacyThinkingLevel !== 'string') return;

      // If the fetched config already has a new variant key, skip.
      if (
        THINKING_LEVEL_VARIANTS.some((key) => typeof (fetchedChatConfig as any)[key] === 'string')
      ) {
        return;
      }

      // If the store already has a new variant key (e.g. user edited quickly), skip without importing model-bank.
      const currentBeforeLookup = this.#get().agentMap?.[agentId] as
        | PartialDeep<LobeAgentConfig>
        | undefined;
      const currentBeforeLookupChatConfig = (currentBeforeLookup?.chatConfig ||
        {}) as LobeAgentChatConfig;
      if (
        THINKING_LEVEL_VARIANTS.some(
          (key) => typeof (currentBeforeLookupChatConfig as any)[key] === 'string',
        )
      ) {
        return;
      }

      const extendParams = await resolveModelExtendParams(config.model, config.provider);
      const variantKey = pickThinkingLevelVariantKey(extendParams);
      if (!variantKey) return;

      // Re-check the latest store state to avoid overwriting user edits during the async lookup.
      const currentAgent = this.#get().agentMap?.[agentId] as
        | PartialDeep<LobeAgentConfig>
        | undefined;
      if (!currentAgent) return;
      if (currentAgent.model !== config.model || currentAgent.provider !== config.provider) return;

      const currentChatConfig = (currentAgent.chatConfig || {}) as LobeAgentChatConfig;
      if (typeof (currentChatConfig as any)[variantKey] === 'string') return;

      const legacyThinkingLevel =
        typeof currentChatConfig.thinkingLevel === 'string'
          ? currentChatConfig.thinkingLevel
          : fetchedLegacyThinkingLevel;

      const allowedLevels = THINKING_LEVEL_VARIANT_LEVELS[variantKey];
      if (!allowedLevels.includes(legacyThinkingLevel as never)) return;

      await this.#get().optimisticUpdateAgentConfig(agentId, {
        chatConfig: {
          [variantKey]: legacyThinkingLevel,
        },
      });
    } finally {
      legacyThinkingLevelMigrationInFlight.delete(agentId);
    }
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
