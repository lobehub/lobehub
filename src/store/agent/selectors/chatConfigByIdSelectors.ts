import {
  DEFAULT_AGENT_CHAT_CONFIG,
  DEFAULT_AGENT_SEARCH_FC_MODEL,
  isDesktop,
} from '@lobechat/const';
import { type LobeAgentChatConfig, type RuntimeEnvMode } from '@lobechat/types';

import { resolveRuntimeMode, resolveToolMode } from '@/helpers/executionTarget';
import { resolveGatewayModeEnabled } from '@/helpers/gatewayMode';
import { type AgentStoreState } from '@/store/agent/initialState';

import { agentSelectors } from './selectors';

/**
 * ChatConfig selectors that get config by agentId parameter.
 * Used in ChatInput components where agentId is passed as prop.
 */

const getStoredChatConfigById =
  (agentId: string) =>
  (s: AgentStoreState): LobeAgentChatConfig =>
    agentSelectors.getAgentConfigById(agentId)(s)?.chatConfig || {};

const getChatConfigById =
  (agentId: string) =>
  (s: AgentStoreState): LobeAgentChatConfig =>
    getStoredChatConfigById(agentId)(s);

const getEnableHistoryCountById = (agentId: string) => (s: AgentStoreState) =>
  getStoredChatConfigById(agentId)(s).enableHistoryCount;

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
 * none).
 */
const getRuntimeModeById =
  (agentId: string) =>
  (s: AgentStoreState): RuntimeEnvMode => {
    const config = agentSelectors.getAgentConfigById(agentId)(s);

    // On web a bound `local` target only surfaces as `device` (not `sandbox`)
    // when Gateway mode is effectively enabled and can route to the device
    // (LOBE-11473). Derive the gate from this selector's own state `s` so it
    // re-evaluates on `disableGatewayMode` changes without a second global read.
    return resolveRuntimeMode(
      config?.agencyConfig,
      isDesktop,
      resolveGatewayModeEnabled(s, agentId),
    );
  };

const getSkillActivateModeById =
  (agentId: string) =>
  (s: AgentStoreState): 'auto' | 'manual' =>
    getChatConfigById(agentId)(s).skillActivateMode ?? 'auto';

/**
 * Resolve the agent's tool mode via the shared `resolveToolMode` helper, so
 * client and server agree on what counts as chat mode.
 */
const getToolModeById =
  (agentId: string) =>
  (s: AgentStoreState): 'agent' | 'chat' | 'custom' =>
    resolveToolMode(getChatConfigById(agentId)(s));

const isChatModeById = (agentId: string) => (s: AgentStoreState) =>
  getToolModeById(agentId)(s) === 'chat';

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
  getToolModeById,
  getUseModelBuiltinSearchById,
  isChatModeById,
  isEnableSearchById,
  isLocalSystemEnabledById,
  isMemoryToolEnabledById,
};
