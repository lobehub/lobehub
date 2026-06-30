import { isDesktop } from '@lobechat/const';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

export interface ChatInputNotice {
  /** Optional inline action button. `switchToLocal` re-targets execution to this machine. */
  action?: 'switchToLocal';
  key: string;
  type: 'info' | 'warning';
}

interface ResolveChatInputNoticeParams {
  currentChatModel?: unknown;
  isHeterogeneousAgent: boolean;
  isModelConfigReady: boolean;
  /** Desktop has selected the ephemeral cloud sandbox as the execution target. */
  isSandboxTarget: boolean;
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
  isHeterogeneousAgent,
  isModelConfigReady,
  isSandboxTarget,
}: ResolveChatInputNoticeParams): ChatInputNotice | undefined => {
  // Model-config notices (warning) take priority over the sandbox tip (info):
  // an unusable model blocks the send, the sandbox is only a softer suggestion.
  // They don't apply to heterogeneous agents (own toolchain) or before the
  // model runtime config is ready.
  if (!isHeterogeneousAgent && isModelConfigReady) {
    // Example: an agent still references `gpt-4-32k`, or a model reclassified to
    // image/video; once absent from the chat selector, it should read as unavailable.
    if (!currentChatModel) return { key: 'input.modelUnavailable', type: 'warning' };
  }

  // Sandbox is an ephemeral environment; nudge desktop users toward a device
  // (e.g. local) for a better experience. Applies to hetero agents too, so it
  // sits outside the model-notice guard above.
  if (isSandboxTarget)
    return { action: 'switchToLocal', key: 'input.sandboxModeNotice', type: 'info' };
};

export const useChatInputNotice = (): ChatInputNotice | undefined => {
  const agentId = useAgentId();

  const [isHeterogeneousAgent, model, provider, agencyConfig] = useAgentStore((s) => [
    agentByIdSelectors.isAgentHeterogeneousById(agentId)(s),
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    agentByIdSelectors.getAgencyConfigById(agentId)(s),
  ]);

  const enabledChatModelList = useEnabledChatModels();
  const isModelConfigReady = useAiInfraStore((s) =>
    aiProviderSelectors.isInitAiProviderRuntimeState(s),
  );
  const currentChatModel = findEnabledChatModel(enabledChatModelList, model, provider);

  // The sandbox suggestion only makes sense on desktop, where `local` is the
  // recommended alternative. `clientExecutionAvailable: isDesktop` matches how
  // HeteroDeviceSwitcher resolves the effective target for the chip.
  const isSandboxTarget =
    isDesktop &&
    resolveExecutionTarget(agencyConfig, {
      clientExecutionAvailable: isDesktop,
      isHetero: isHeterogeneousAgent,
    }) === 'sandbox';

  return resolveChatInputNotice({
    currentChatModel,
    isHeterogeneousAgent,
    isModelConfigReady,
    isSandboxTarget,
  });
};
