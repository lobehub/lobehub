import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

interface ResolveChatInputNoticeParams {
  currentChatModel?: unknown;
  isGroupContext?: boolean;
  isHeterogeneousAgent: boolean;
  isModelConfigReady: boolean;
  isResourceViewOnly?: boolean;
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

export const resolveChatInputNotice = ({
  currentChatModel,
  isGroupContext,
  isHeterogeneousAgent,
  isModelConfigReady,
  isResourceViewOnly,
}: ResolveChatInputNoticeParams) => {
  // View-level General access on the bound agent/group makes the whole input
  // read-only — that outranks any model-config notice (nothing can be sent).
  if (isResourceViewOnly)
    return {
      action: undefined,
      key: isGroupContext ? 'input.viewOnlyGroup' : 'input.viewOnlyAgent',
      type: 'warning',
    } as const;

  // Model-config notices don't apply to heterogeneous agents (own toolchain) or
  // before the model runtime config is ready.
  if (
    !isHeterogeneousAgent &&
    isModelConfigReady && // Example: an agent still references `gpt-4-32k`, or a model reclassified to
    // image/video; once absent from the chat selector, it should read as unavailable.
    !currentChatModel
  )
    return { action: undefined, key: 'input.modelUnavailable', type: 'warning' } as const;
};

/** Union of every notice shape `resolveChatInputNotice` can return. */
export type ChatInputNotice = NonNullable<ReturnType<typeof resolveChatInputNotice>>;

export const useChatInputNotice = (): ChatInputNotice | undefined => {
  const agentId = useAgentId();

  const [isHeterogeneousAgent, model, provider] = useAgentStore((s) => [
    agentByIdSelectors.isAgentHeterogeneousById(agentId)(s),
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
  ]);

  const enabledChatModelList = useEnabledChatModels();
  const isModelConfigReady = useAiInfraStore((s) =>
    aiProviderSelectors.isInitAiProviderRuntimeState(s),
  );
  const currentChatModel = findEnabledChatModel(enabledChatModelList, model, provider);
  const { canUseResource, isGroupContext } = useChatInputResourceAccess();

  return resolveChatInputNotice({
    currentChatModel,
    isGroupContext,
    isHeterogeneousAgent,
    isModelConfigReady,
    isResourceViewOnly: !canUseResource,
  });
};
