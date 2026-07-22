import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useAgentModelSelection } from '@/features/ChatInput/hooks/useAgentModelSelection';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

interface ResolveChatInputNoticeParams {
  currentChatModel?: unknown;
  isAgentModelPending: boolean;
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
  isAgentModelPending,
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
  // before the model runtime config is ready, or before the agent's effective
  // model is settled. The last one matters on a cold page load: until
  // `agentMap` has the agent (and, for a member-selection workspace agent,
  // until the member override is fetched), the model resolves to the
  // DEFAULT_MODEL/DEFAULT_PROVIDER fallback, which is often absent from the
  // user's enabled list — that used to flash the "model offline" warning for a
  // frame before the real config resolved.
  if (
    !isHeterogeneousAgent &&
    isModelConfigReady &&
    !isAgentModelPending && // Example: an agent still references `gpt-4-32k`, or a model reclassified to
    // image/video; once absent from the chat selector, it should read as unavailable.
    !currentChatModel
  )
    return { action: undefined, key: 'input.modelUnavailable', type: 'warning' } as const;
};

/** Union of every notice shape `resolveChatInputNotice` can return. */
export type ChatInputNotice = NonNullable<ReturnType<typeof resolveChatInputNotice>>;

export const useChatInputNotice = (): ChatInputNotice | undefined => {
  const agentId = useAgentId();

  const [isAgentConfigLoading, isHeterogeneousAgent] = useAgentStore((s) => [
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
    agentByIdSelectors.isAgentHeterogeneousById(agentId)(s),
  ]);

  // Same source as the model trigger renders, so the notice can never judge a
  // different model than the one the user sees (member overrides included).
  const { isPreferenceLoading, model, provider, selectionPolicy } = useAgentModelSelection(agentId);

  // `isPreferenceLoading` is true for every workspace agent while the shared
  // preferences request is in flight, but the override only feeds the
  // effective model under the `member` policy (`resolveAgentModelConfig`).
  // Waiting on it for a `fixed` agent would swallow a genuine warning.
  const isMemberOverridePending = selectionPolicy === 'member' && isPreferenceLoading;

  const enabledChatModelList = useEnabledChatModels();
  const isModelConfigReady = useAiInfraStore((s) =>
    aiProviderSelectors.isInitAiProviderRuntimeState(s),
  );
  const currentChatModel = findEnabledChatModel(enabledChatModelList, model, provider);
  const { canUseResource, isGroupContext } = useChatInputResourceAccess();

  return resolveChatInputNotice({
    currentChatModel,
    isAgentModelPending: isAgentConfigLoading || isMemberOverridePending,
    isGroupContext,
    isHeterogeneousAgent,
    isModelConfigReady,
    isResourceViewOnly: !canUseResource,
  });
};
