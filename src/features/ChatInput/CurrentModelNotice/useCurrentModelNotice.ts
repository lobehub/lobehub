import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

interface CurrentModelNoticeModel {
  abilities?: {
    functionCall?: boolean;
  };
}

interface ResolveCurrentModelNoticeKeyParams {
  currentChatModel?: CurrentModelNoticeModel;
  enableAgentMode: boolean;
  isHeterogeneousAgent: boolean;
  isModelConfigReady: boolean;
}

const findEnabledChatModel = (
  enabledChatModelList: EnabledProviderWithModels[],
  model: string,
  provider: string,
) => {
  return enabledChatModelList
    .find((item) => item.id === provider)
    ?.children.find((item) => item.id === model);
};

export const resolveCurrentModelNoticeKey = ({
  currentChatModel,
  enableAgentMode,
  isHeterogeneousAgent,
  isModelConfigReady,
}: ResolveCurrentModelNoticeKeyParams) => {
  if (isHeterogeneousAgent || !isModelConfigReady) return;

  // Example: an agent still references `gpt-4-32k`, or a model reclassified to
  // image/video; once absent from the chat selector, it should read as unavailable.
  if (!currentChatModel) return 'input.modelUnavailable';

  if (enableAgentMode && !currentChatModel.abilities?.functionCall)
    return 'input.agentModeUnsupportedModel';
};

export const useCurrentModelNotice = () => {
  const agentId = useAgentId();

  const [enableAgentMode, isHeterogeneousAgent, model, provider] = useAgentStore((s) => [
    agentByIdSelectors.getAgentEnableModeById(agentId)(s),
    agentByIdSelectors.isAgentHeterogeneousById(agentId)(s),
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
  ]);

  const enabledChatModelList = useEnabledChatModels();
  const isModelConfigReady = useAiInfraStore((s) =>
    aiProviderSelectors.isInitAiProviderRuntimeState(s),
  );
  const currentChatModel = findEnabledChatModel(enabledChatModelList, model, provider);

  return resolveCurrentModelNoticeKey({
    currentChatModel,
    enableAgentMode,
    isHeterogeneousAgent,
    isModelConfigReady,
  });
};
