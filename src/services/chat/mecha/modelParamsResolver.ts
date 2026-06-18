import {
  applyModelExtendParams,
  type ModelExtendParams,
  resolveDefaultThinkingLevelForModel,
} from '@lobechat/model-runtime';
import type { LobeAgentChatConfig } from '@lobechat/types';

import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';

export type { ModelExtendParams };
export { resolveDefaultThinkingLevelForModel };

/**
 * Context for resolving model parameters
 */
export interface ModelParamsContext {
  chatConfig: LobeAgentChatConfig;
  model: string;
  provider: string;
}

/**
 * Resolves extended parameters for model runtime based on model capabilities and chat config.
 *
 * Looks up the model's supported `extendParams` from the aiInfra store, then delegates the
 * actual resolution to the shared `applyModelExtendParams` (in `@lobechat/model-runtime`) so the
 * client chat service and the server-side agent runtime stay in sync.
 */
export const resolveModelExtendParams = (ctx: ModelParamsContext): ModelExtendParams => {
  const { model, provider, chatConfig } = ctx;

  const aiInfraStoreState = getAiInfraStoreState();

  const isModelHasExtendParams = aiModelSelectors.isModelHasExtendParams(
    model,
    provider,
  )(aiInfraStoreState);

  if (!isModelHasExtendParams) {
    return {};
  }

  const modelExtendParams = aiModelSelectors.modelExtendParams(model, provider)(aiInfraStoreState);

  return applyModelExtendParams({ chatConfig, extendParams: modelExtendParams, model });
};
