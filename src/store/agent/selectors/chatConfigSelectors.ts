import { type LobeAgentChatConfig } from '@lobechat/types';

import { type AgentStoreState } from '@/store/agent/initialState';

import { chatConfigByIdSelectors } from './chatConfigByIdSelectors';

// ============ Current Agent Selectors (复用 chatConfigByIdSelectors) ============ //

const currentChatConfig = (s: AgentStoreState): LobeAgentChatConfig =>
  chatConfigByIdSelectors.getChatConfigById(s.activeAgentId || '')(s);

const agentSearchMode = (s: AgentStoreState) =>
  chatConfigByIdSelectors.getSearchModeById(s.activeAgentId || '')(s);

const isAgentEnableSearch = (s: AgentStoreState) =>
  chatConfigByIdSelectors.isEnableSearchById(s.activeAgentId || '')(s);

const useModelBuiltinSearch = (s: AgentStoreState) =>
  chatConfigByIdSelectors.getUseModelBuiltinSearchById(s.activeAgentId || '')(s);

const searchFCModel = (s: AgentStoreState) =>
  chatConfigByIdSelectors.getSearchFCModelById(s.activeAgentId || '')(s);

const enableHistoryCount = (s: AgentStoreState) =>
  chatConfigByIdSelectors.getEnableHistoryCountById(s.activeAgentId || '')(s);

const historyCount = (s: AgentStoreState): number =>
  chatConfigByIdSelectors.getHistoryCountById(s.activeAgentId || '')(s);

const enableHistoryDivider =
  (historyLength: number, currentIndex: number) => (s: AgentStoreState) => {
    const config = currentChatConfig(s);

    return (
      enableHistoryCount(s) &&
      historyLength > (config.historyCount ?? 0) &&
      config.historyCount === historyLength - currentIndex
    );
  };

export const agentChatConfigSelectors = {
  agentSearchMode,
  currentChatConfig,
  enableHistoryCount,
  enableHistoryDivider,
  historyCount,
  isAgentEnableSearch,
  searchFCModel,
  useModelBuiltinSearch,
};
