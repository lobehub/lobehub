'use client';

import { agentProjectionSelectors, useAgentValue } from '@/store/agent/projection';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from './useAgentId';
import { useEffectiveModel } from './useEffectiveModel';

/**
 * Hook to check if search is enabled for the current agent context.
 * Uses agentId from ChatInput store if provided, otherwise falls back to activeAgentId.
 */
export const useAgentEnableSearch = () => {
  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);
  const agentSearchMode = useAgentValue(agentId, agentProjectionSelectors.searchMode);

  const searchImpl = useAiInfraStore(aiModelSelectors.modelBuiltinSearchImpl(model, provider));

  // If using a built-in search implementation, web search is always available
  if (searchImpl === 'internal') return true;

  // If the search mode is off, web search is never available
  return agentSearchMode !== 'off';
};
