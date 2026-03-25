import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { AUTO_MODEL_ID, AUTO_MODEL_PROVIDER } from '@/utils/modelAccess';

export const useModelAndProvider = (modelProp?: string, providerProp?: string) => {
  const [storeModel, storeProvider] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentSelectors.currentAgentModelProvider(s),
  ]);

  const model = modelProp ?? storeModel;
  const provider = model === AUTO_MODEL_ID ? AUTO_MODEL_PROVIDER : (providerProp ?? storeProvider);

  return { model, provider };
};
