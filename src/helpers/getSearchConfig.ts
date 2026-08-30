import { resolveSearchDecision, type SearchDecision } from 'model-bank';

import { getAgentProjectionById } from '@/projection';
import { getAgentStoreState } from '@/store/agent';
import { agentProjectionSelectors } from '@/store/agent/projection';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';

/**
 * Search configuration result
 */
export type SearchConfig = SearchDecision;

/**
 * Get search configuration for given model and provider
 * This centralizes the search logic that was duplicated across multiple places
 * @param model - The model name
 * @param provider - The provider name
 * @param agentId - Optional agent ID to get agent-specific chat config
 */
export const getSearchConfig = (
  model: string,
  provider: string,
  agentId?: string,
): SearchConfig => {
  const agentStoreState = getAgentStoreState();
  const targetAgentId = agentId || agentStoreState.activeAgentId || '';
  const chatConfig = agentProjectionSelectors.chatConfig(getAgentProjectionById(targetAgentId));
  const aiInfraStoreState = getAiInfraStoreState();

  const providerSearchMode =
    aiProviderSelectors.providerConfigById(provider)(aiInfraStoreState)?.settings.searchMode;
  const modelSearchImpl = aiModelSelectors.modelBuiltinSearchImpl(
    model,
    provider,
  )(aiInfraStoreState);

  return resolveSearchDecision({
    modelSearchImpl,
    providerSearchMode,
    searchMode: chatConfig.searchMode,
    useModelBuiltinSearch: chatConfig.useModelBuiltinSearch,
  });
};
