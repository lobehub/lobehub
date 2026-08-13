import { agentProjectionSelectors, useCurrentAgentValue } from '@/store/agent/projection';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useModelHasContextWindowToken = () => {
  const model = useCurrentAgentValue(agentProjectionSelectors.model);
  const provider = useCurrentAgentValue(agentProjectionSelectors.provider);

  return useAiInfraStore(aiModelSelectors.isModelHasContextWindowToken(model, provider));
};
