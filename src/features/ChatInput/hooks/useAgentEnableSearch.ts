'use client';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from './useAgentId';

/**
 * Hook to check if search is enabled for the current agent context.
 * Uses agentId from ChatInput store if provided, otherwise falls back to activeAgentId.
 */
export const useAgentEnableSearch = () => {
  const agentId = useAgentId();
  const [model, provider, agentSearchMode] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    chatConfigByIdSelectors.getSearchModeById(agentId)(s),
  ]);

  const searchImpl = useAiInfraStore(aiModelSelectors.modelBuiltinSearchImpl(model, provider));

  // If using a built-in search implementation, web search is always available
  if (searchImpl === 'internal') return true;

  // If the search mode is off, web search is never available
  return agentSearchMode !== 'off';
};
