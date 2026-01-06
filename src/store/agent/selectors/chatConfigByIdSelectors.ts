import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_SEARCH_FC_MODEL } from '@lobechat/const';
import { isContextCachingModel, isThinkingWithToolClaudeModel } from '@lobechat/model-runtime';
import { type LobeAgentChatConfig } from '@lobechat/types';

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

const getEnableHistoryCountById = (agentId: string) => (s: AgentStoreState) => {
  const config = agentSelectors.getAgentConfigById(agentId)(s);
  const chatConfig = getChatConfigById(agentId)(s);

  // 如果开启了上下文缓存，且当前模型类型匹配，则不开启历史记录
  const enableContextCaching = !chatConfig.disableContextCaching;

  if (enableContextCaching && config?.model && isContextCachingModel(config.model)) return false;

  // 当开启搜索时，针对 claude 3.7 sonnet 模型不开启历史记录
  const searchMode = chatConfig.searchMode || 'off';
  const enableSearch = searchMode !== 'off';

  if (enableSearch && config?.model && isThinkingWithToolClaudeModel(config.model)) return false;

  return chatConfig.enableHistoryCount;
};

const getHistoryCountById =
  (agentId: string) =>
  (s: AgentStoreState): number => {
    const chatConfig = getChatConfigById(agentId)(s);

    return chatConfig.historyCount ?? (DEFAULT_AGENT_CHAT_CONFIG.historyCount as number);
  };

const getSearchModeById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).searchMode || 'off';

const isEnableSearchById = (agentId: string) => (s: AgentStoreState) =>
  getSearchModeById(agentId)(s) !== 'off';

const getUseModelBuiltinSearchById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).useModelBuiltinSearch;

const getSearchFCModelById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).searchFCModel || DEFAULT_AGENT_SEARCH_FC_MODEL;

export const chatConfigByIdSelectors = {
  getChatConfigById,
  getEnableHistoryCountById,
  getHistoryCountById,
  getSearchFCModelById,
  getSearchModeById,
  getUseModelBuiltinSearchById,
  isEnableSearchById,
};
