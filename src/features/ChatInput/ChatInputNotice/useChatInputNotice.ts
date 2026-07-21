import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

interface ResolveChatInputNoticeParams {
  currentChatModel?: unknown;
  isAgentConfigLoading: boolean;
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
  isAgentConfigLoading,
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

  // Model-config notices don't apply to heterogeneous agents (own toolchain),
  // before the model runtime config is ready, or before the agent config lands.
  // The last one matters on a cold page load: until `agentMap` has the agent,
  // the model selectors fall back to DEFAULT_MODEL/DEFAULT_PROVIDER, which is
  // often absent from the user's enabled list — that used to flash the
  // "model offline" warning for a frame before the real config resolved.
  if (
    !isHeterogeneousAgent &&
    isModelConfigReady &&
    !isAgentConfigLoading && // Example: an agent still references `gpt-4-32k`, or a model reclassified to
    // image/video; once absent from the chat selector, it should read as unavailable.
    !currentChatModel
  )
    return { action: undefined, key: 'input.modelUnavailable', type: 'warning' } as const;
};

/** Union of every notice shape `resolveChatInputNotice` can return. */
export type ChatInputNotice = NonNullable<ReturnType<typeof resolveChatInputNotice>>;

export const useChatInputNotice = (): ChatInputNotice | undefined => {
  const agentId = useAgentId();

  const [isAgentConfigLoading, isHeterogeneousAgent, model, provider] = useAgentStore((s) => [
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
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
    isAgentConfigLoading,
    isGroupContext,
    isHeterogeneousAgent,
    isModelConfigReady,
    isResourceViewOnly: !canUseResource,
  });
};
