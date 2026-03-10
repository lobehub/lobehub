import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useAgentEnableSearch = () => {
  const [model, provider, agentSearchMode] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentSelectors.currentAgentModelProvider(s),
    agentChatConfigSelectors.agentSearchMode(s),
  ]);

  const searchImpl = useAiInfraStore(aiModelSelectors.modelBuiltinSearchImpl(model, provider));

  // Built-in search implementations always support web search
  if (searchImpl === 'internal') return true;

  // If disabled, web search is not allowed
  return agentSearchMode !== 'off';
};
