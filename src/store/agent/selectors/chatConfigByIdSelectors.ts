import {
  DEFAULT_AGENT_CHAT_CONFIG,
  DEFAULT_AGENT_SEARCH_FC_MODEL,
  isDesktop,
} from '@lobechat/const';
import { type LobeAgentChatConfig, type RuntimeEnvMode } from '@lobechat/types';

import { resolveRuntimeMode } from '@/helpers/executionTarget';
import { type AgentStoreState } from '@/store/agent/initialState';

import { agentSelectors } from './selectors';

/**
 * ChatConfig selectors that get config by agentId parameter.
 * Used in ChatInput components where agentId is passed as prop.
 */

const getChatConfigById =
  (agentId: string) =>
  (s: AgentStoreState): LobeAgentChatConfig =>
    agentSelectors.getAgentConfigById(agentId)(s)?.chatConfig || {};

// Return raw chatConfig value without business logic overrides
const getEnableHistoryCountById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).enableHistoryCount;

const getHistoryCountById =
  (agentId: string) =>
  (s: AgentStoreState): number => {
    const chatConfig = getChatConfigById(agentId)(s);

    return chatConfig.historyCount ?? (DEFAULT_AGENT_CHAT_CONFIG.historyCount as number);
  };

const getSearchModeById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).searchMode || 'auto';

const isEnableSearchById = (agentId: string) => (s: AgentStoreState) =>
  getSearchModeById(agentId)(s) !== 'off';

const getUseModelBuiltinSearchById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).useModelBuiltinSearch;

const getSearchFCModelById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).searchFCModel || DEFAULT_AGENT_SEARCH_FC_MODEL;

const getMemoryToolConfigById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).memory;

const isMemoryToolEnabledById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).memory?.enabled ?? false;

const getMemoryToolEffortById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).memory?.effort ?? 'medium';

const getRuntimeEnvConfigById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).runtimeEnv;

const isLocalSystemEnabledById = (agentId: string) => (s: AgentStoreState) =>
  getRuntimeModeById(agentId)(s) === 'local';

/**
 * Get the agent's runtime mode, derived from the unified
 * `agencyConfig.executionTarget` (sandbox → cloud, local → local, device →
 * none), falling back to the legacy per-platform `runtimeMode` for agents that
 * predate `executionTarget`.
 */
const getRuntimeModeById =
  (agentId: string) =>
  (s: AgentStoreState): RuntimeEnvMode => {
    const config = agentSelectors.getAgentConfigById(agentId)(s);
    const platform = isDesktop ? 'desktop' : 'web';

    return resolveRuntimeMode(
      config?.agencyConfig,
      config?.chatConfig?.runtimeEnv?.runtimeMode?.[platform],
      isDesktop,
    );
  };

const getSkillActivateModeById =
  (agentId: string) =>
  (s: AgentStoreState): 'auto' | 'manual' =>
    getChatConfigById(agentId)(s).skillActivateMode ?? 'auto';

export const chatConfigByIdSelectors = {
  getChatConfigById,
  getEnableHistoryCountById,
  getHistoryCountById,
  getRuntimeEnvConfigById,
  getMemoryToolConfigById,
  getMemoryToolEffortById,
  getRuntimeModeById,
  getSearchFCModelById,
  getSearchModeById,
  getSkillActivateModeById,
  getUseModelBuiltinSearchById,
  isEnableSearchById,
  isLocalSystemEnabledById,
  isMemoryToolEnabledById,
};
