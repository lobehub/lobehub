import {
  applyModelExtendParams,
  type ModelExtendParams,
  resolveDefaultEnableAdaptiveThinkingForModel,
  resolveDefaultThinkingLevelForModel,
  resolveEffectiveReasoningChatConfig,
} from '@lobechat/model-runtime/utils/modelExtendParams';
import type { LobeAgentChatConfig } from '@lobechat/types';

import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';

export type { ModelExtendParams };
export { resolveDefaultEnableAdaptiveThinkingForModel, resolveDefaultThinkingLevelForModel };

/**
 * Context for resolving model parameters
 */
export interface ModelParamsContext {
  chatConfig: LobeAgentChatConfig;
  model: string;
  provider: string;
  /**
   * Raw sub-agent chatConfig override; explicit reasoning fields set here win
   * over the user's model-instance defaults.
   */
  subAgentChatConfigOverride?: Partial<LobeAgentChatConfig>;
}

/**
 * Resolves extended parameters for model runtime based on model capabilities and chat config.
 *
 * Looks up the model's supported `extendParams` from the aiInfra store, then delegates the
 * actual resolution to the shared `applyModelExtendParams` so the client chat service and the
 * server-side agent runtime stay in sync.
 *
 * Reasoning fields (effort family + reasoningMode) are user-level model-instance settings:
 * same-named agent chatConfig values are ignored and the personal-scope config from the
 * aiInfra store applies instead — except explicit sub-agent overrides, which stay honored.
 */
export const resolveModelExtendParams = (ctx: ModelParamsContext): ModelExtendParams => {
  const { model, provider, chatConfig, subAgentChatConfigOverride } = ctx;

  const aiInfraStoreState = getAiInfraStoreState();

  const isModelHasExtendParams = aiModelSelectors.isModelHasExtendParams(
    model,
    provider,
  )(aiInfraStoreState);

  if (!isModelHasExtendParams) {
    return {};
  }

  const modelExtendParams = aiModelSelectors.modelExtendParams(model, provider)(aiInfraStoreState);

  const effectiveChatConfig = resolveEffectiveReasoningChatConfig({
    agentChatConfig: chatConfig,
    modelReasoningConfig: aiModelSelectors.modelReasoningConfig(model, provider)(aiInfraStoreState),
    subAgentReasoningOverrides: subAgentChatConfigOverride,
  });

  return applyModelExtendParams({
    chatConfig: effectiveChatConfig,
    extendParams: modelExtendParams,
    model,
  });
};
