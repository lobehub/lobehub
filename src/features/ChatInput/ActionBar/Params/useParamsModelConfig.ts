import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentModelSelection } from '../../hooks/useAgentModelSelection';
import { useTopicModel } from '../../hooks/useEffectiveModel';

export const useParamsModelConfig = (agentId: string) => {
  const { model: selectedAgentModel, provider: selectedAgentProvider } =
    useAgentModelSelection(agentId);
  const topicModel = useTopicModel();
  const model = topicModel?.model ?? selectedAgentModel;
  const provider = topicModel?.model ? topicModel.provider : selectedAgentProvider;

  const hasModelConfig = useAiInfraStore(aiModelSelectors.isModelHasExtendParams(model, provider));
  const disabledParams = useAiInfraStore(aiModelSelectors.modelDisabledParams(model, provider));

  return { disabledParams, hasModelConfig, model, provider };
};
