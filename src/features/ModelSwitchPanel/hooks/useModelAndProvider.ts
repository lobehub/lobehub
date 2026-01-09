import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

export const useModelAndProvider = (modelProp?: string, providerProp?: string) => {
  const [storeModel, storeProvider] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentSelectors.currentAgentModelProvider(s),
  ]);

  const model = modelProp ?? storeModel;
  const provider = providerProp ?? storeProvider;

  return { model, provider };
};
