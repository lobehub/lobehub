import type { ModelExtendParams } from '@lobechat/model-runtime';
import {
  applyModelExtendParams,
  isThinkingLevelExtendParam,
  resolveDefaultEnableAdaptiveThinkingForModel,
  resolveDefaultThinkingLevelForModel,
  resolveEnableReasoningValue,
  resolveThinkingLevelDefault,
} from '@lobechat/model-runtime';
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

  const extendParams: ModelExtendParams = {};

  if (!modelExtendParams) {
    return extendParams;
  }

  // Reasoning configuration
  if (modelExtendParams.includes('enableReasoning')) {
    const enableReasoning = resolveEnableReasoningValue(chatConfig);

    if (enableReasoning) {
      const thinking: NonNullable<ModelExtendParams['thinking']> = {
        type: 'enabled',
      };

      // Determine which budget field to use based on model support
      let budgetTokens: number | undefined;
      if (modelExtendParams.includes('reasoningBudgetToken32k')) {
        budgetTokens = chatConfig.reasoningBudgetToken32k || 1024;
      } else if (modelExtendParams.includes('reasoningBudgetToken80k')) {
        budgetTokens = chatConfig.reasoningBudgetToken80k || 1024;
      } else {
        budgetTokens = chatConfig.reasoningBudgetToken || 1024;
      }

      thinking.budget_tokens = budgetTokens;
      extendParams.thinking = thinking;
    } else {
      extendParams.thinking = {
        budget_tokens: 0,
        type: 'disabled',
      };
    }
  } else if (modelExtendParams.includes('reasoningBudgetToken32k')) {
    // For models that only have reasoningBudgetToken32k without enableReasoning
    extendParams.thinking = {
      budget_tokens: chatConfig.reasoningBudgetToken32k || 1024,
      type: 'enabled',
    };
  } else if (modelExtendParams.includes('reasoningBudgetToken80k')) {
    // For models that only have reasoningBudgetToken80k without enableReasoning
    extendParams.thinking = {
      budget_tokens: chatConfig.reasoningBudgetToken80k || 1024,
      type: 'enabled',
    };
  } else if (modelExtendParams.includes('reasoningBudgetToken')) {
    // For models that only have reasoningBudgetToken without enableReasoning
    extendParams.thinking = {
      budget_tokens: chatConfig.reasoningBudgetToken || 1024,
    };
  }

  // Adaptive thinking (Claude Opus/Sonnet 4.6)
  if (modelExtendParams.includes('enableAdaptiveThinking')) {
    if (chatConfig.enableAdaptiveThinking) {
      extendParams.thinking = {
        type: 'adaptive',
      };
    } else if (!modelExtendParams.includes('enableReasoning')) {
      // Only disable when the model has no enableReasoning fallback
      extendParams.thinking = {
        type: 'disabled',
      };
    }
    // When adaptive is off and model also has enableReasoning, let enableReasoning result stand
  }

  // Context caching
  if (modelExtendParams.includes('disableContextCaching') && chatConfig.disableContextCaching) {
    extendParams.enabledContextCaching = false;
  }

  // Preserve historical thinking content (provider support required)
  if (
    modelExtendParams.includes('preserveThinking') &&
    typeof chatConfig.preserveThinking === 'boolean'
  ) {
    extendParams.preserveThinking = chatConfig.preserveThinking;
  }

  // Reasoning effort variants
  if (modelExtendParams.includes('reasoningEffort') && chatConfig.reasoningEffort) {
    extendParams.reasoning_effort = chatConfig.reasoningEffort;
  }

  if (modelExtendParams.includes('gpt5ReasoningEffort') && chatConfig.gpt5ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.gpt5ReasoningEffort;
  }

  if (modelExtendParams.includes('gpt5_1ReasoningEffort') && chatConfig.gpt5_1ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.gpt5_1ReasoningEffort;
  }

  if (modelExtendParams.includes('gpt5_2ReasoningEffort') && chatConfig.gpt5_2ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.gpt5_2ReasoningEffort;
  }

  if (
    modelExtendParams.includes('gpt5_2ProReasoningEffort') &&
    chatConfig.gpt5_2ProReasoningEffort
  ) {
    extendParams.reasoning_effort = chatConfig.gpt5_2ProReasoningEffort;
  }

  if (modelExtendParams.includes('grok4_20ReasoningEffort') && chatConfig.grok4_20ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.grok4_20ReasoningEffort;
  }

  if (modelExtendParams.includes('grok4_3ReasoningEffort') && chatConfig.grok4_3ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.grok4_3ReasoningEffort;
  }

  if (modelExtendParams.includes('hy3ReasoningEffort') && chatConfig.hy3ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.hy3ReasoningEffort;
  }

  if (modelExtendParams.includes('ring2_6ReasoningEffort') && chatConfig.ring2_6ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.ring2_6ReasoningEffort;
  }

  if (modelExtendParams.includes('codexMaxReasoningEffort') && chatConfig.codexMaxReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.codexMaxReasoningEffort;
  }

  // DeepSeek reasoning effort is reconciled last to avoid invalid combinations.
  if (modelExtendParams.includes('deepseekV4ReasoningEffort')) {
    const deepseekV4ReasoningEffort = chatConfig.deepseekV4ReasoningEffort;

    if (typeof deepseekV4ReasoningEffort === 'string') {
      if (deepseekV4ReasoningEffort === 'none') {
        delete extendParams.reasoning_effort;
        extendParams.thinking = {
          type: 'disabled',
        };
      } else {
        extendParams.reasoning_effort = deepseekV4ReasoningEffort;
        extendParams.thinking = {
          type: 'enabled',
        };
      }
    }
  }

  if (modelExtendParams.includes('effort') && chatConfig.effort) {
    extendParams.effort = chatConfig.effort;
  }

  if (modelExtendParams.includes('opus47Effort') && chatConfig.opus47Effort) {
    extendParams.effort = chatConfig.opus47Effort;
  }

  if (modelExtendParams.includes('step3_5ReasoningEffort') && chatConfig.step3_5ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.step3_5ReasoningEffort;
  }

  // Text verbosity
  if (modelExtendParams.includes('textVerbosity') && chatConfig.textVerbosity) {
    extendParams.verbosity = chatConfig.textVerbosity;
  }

  // Thinking configuration
  if (modelExtendParams.includes('thinking') && chatConfig.thinking) {
    extendParams.thinking = { type: chatConfig.thinking };
  }

  if (modelExtendParams.includes('thinkingBudget') && chatConfig.thinkingBudget !== undefined) {
    extendParams.thinkingBudget = chatConfig.thinkingBudget;
  }

  const supportedThinkingLevelParams = modelExtendParams.filter(isThinkingLevelExtendParam);

  for (const supportedThinkingLevelParam of supportedThinkingLevelParams) {
    const value = chatConfig[supportedThinkingLevelParam];

    if (typeof value === 'string') {
      extendParams.thinkingLevel = value;
      break;
    }
  }

  if (!extendParams.thinkingLevel && supportedThinkingLevelParams.length > 0) {
    extendParams.thinkingLevel = resolveThinkingLevelDefault(
      model,
      supportedThinkingLevelParams[0],
    );
  }

  // URL context
  if (modelExtendParams.includes('urlContext') && chatConfig.urlContext) {
    extendParams.urlContext = chatConfig.urlContext;
  }

  // Image generation params
  if (modelExtendParams.includes('imageAspectRatio') && chatConfig.imageAspectRatio) {
    extendParams.imageAspectRatio = chatConfig.imageAspectRatio;
  }

  if (modelExtendParams.includes('imageAspectRatio2') && chatConfig.imageAspectRatio2) {
    extendParams.imageAspectRatio = chatConfig.imageAspectRatio2;
  }

  if (modelExtendParams.includes('imageResolution') && chatConfig.imageResolution) {
    extendParams.imageResolution = chatConfig.imageResolution;
  }

  if (modelExtendParams.includes('imageResolution2') && chatConfig.imageResolution2) {
    extendParams.imageResolution = chatConfig.imageResolution2;
  }

  return extendParams;
};
