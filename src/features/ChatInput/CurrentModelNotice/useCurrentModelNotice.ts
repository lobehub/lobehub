import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

interface CurrentModelNoticeModel {
  abilities?: {
    functionCall?: boolean;
  };
}

interface ResolveCurrentModelNoticeKeyParams {
  currentModel?: CurrentModelNoticeModel;
  enableAgentMode: boolean;
  isHeterogeneousAgent: boolean;
  isModelConfigReady: boolean;
}

export const resolveCurrentModelNoticeKey = ({
  currentModel,
  enableAgentMode,
  isHeterogeneousAgent,
  isModelConfigReady,
}: ResolveCurrentModelNoticeKeyParams) => {
  if (isHeterogeneousAgent || !isModelConfigReady) return;

  // Example: an agent still references a removed model like `gpt-4-32k`;
  // missing model cards should read as unavailable, not as unsupported tool calls.
  if (!currentModel) return 'input.modelUnavailable';

  if (enableAgentMode && !currentModel.abilities?.functionCall)
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

  const [isModelConfigReady, currentModel] = useAiInfraStore((s) => [
    aiProviderSelectors.isInitAiProviderRuntimeState(s),
    aiModelSelectors.getEnabledModelById(model, provider)(s),
  ]);

  return resolveCurrentModelNoticeKey({
    currentModel,
    enableAgentMode,
    isHeterogeneousAgent,
    isModelConfigReady,
  });
};
