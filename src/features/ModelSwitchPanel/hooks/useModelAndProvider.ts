import { agentProjectionSelectors, useCurrentAgentValue } from '@/store/agent/projection';

export const useModelAndProvider = (modelProp?: string, providerProp?: string) => {
  const storeModel = useCurrentAgentValue(agentProjectionSelectors.model);
  const storeProvider = useCurrentAgentValue(agentProjectionSelectors.provider);

  const model = modelProp ?? storeModel;
  const provider = providerProp ?? storeProvider;

  return { model, provider };
};
