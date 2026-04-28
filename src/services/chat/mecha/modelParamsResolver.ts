import type { LobeAgentChatConfig } from '@lobechat/types';
import type { ExtendParamsType } from 'model-bank';

import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';

/**
 * Context for resolving model parameters
 */
export interface ModelParamsContext {
  chatConfig: LobeAgentChatConfig;
  model: string;
  provider: string;
}

/**
 * Extended parameters for model runtime
 */
export interface ModelExtendParams {
  effort?: string;
  enabledContextCaching?: boolean;
  imageAspectRatio?: string;
  imageResolution?: string;
  reasoning_effort?: string;
  thinking?: {
    budget_tokens?: number;
    type?: string;
  };
  thinkingBudget?: number;
  thinkingLevel?: string;
  urlContext?: boolean;
  verbosity?: string;
}

const DEFAULT_THINKING_LEVEL_BY_EXTEND_PARAM = {
  thinkingLevel: 'high',
  thinkingLevel2: 'high',
  thinkingLevel3: 'high',
  thinkingLevel4: 'minimal',
  thinkingLevel5: 'minimal',
} as const satisfies Partial<Record<ExtendParamsType, string>>;

const THINKING_LEVEL_PARAM_TO_CONFIG_KEY = {
  thinkingLevel: 'thinkingLevel',
  thinkingLevel2: 'thinkingLevel2',
  thinkingLevel3: 'thinkingLevel3',
  thinkingLevel4: 'thinkingLevel4',
  thinkingLevel5: 'thinkingLevel5',
} as const satisfies Partial<Record<ExtendParamsType, keyof LobeAgentChatConfig>>;

/**
 * Preserves legacy `thinking` preferences for users created before `enableReasoning`.
 * Without this fallback, an old `thinking: 'disabled'` setting would be treated as unset
 * and could be overwritten by a model-level default such as DeepSeek V4 reasoning enabled.
 */
const resolveEnableReasoningValue = (
  chatConfig: LobeAgentChatConfig,
  defaultValue?: boolean,
): boolean | undefined => {
  if (Object.hasOwn(chatConfig, 'enableReasoning')) return chatConfig.enableReasoning;

  if (chatConfig.thinking === 'enabled') return true;
  if (chatConfig.thinking === 'disabled') return false;

  return defaultValue;
};

/**
 * Resolves extended parameters for model runtime based on model capabilities and chat config
 *
 * This function checks what extended parameters the model supports and applies
 * the corresponding values from chat config.
 */
export const resolveModelExtendParams = (ctx: ModelParamsContext): ModelExtendParams => {
  const { model, provider, chatConfig } = ctx;
  const extendParams: ModelExtendParams = {};

  const aiInfraStoreState = getAiInfraStoreState();

  const isModelHasExtendParams = aiModelSelectors.isModelHasExtendParams(
    model,
    provider,
  )(aiInfraStoreState);

  if (!isModelHasExtendParams) {
    return extendParams;
  }

  const modelExtendParams = aiModelSelectors.modelExtendParams(model, provider)(aiInfraStoreState);

  if (!modelExtendParams) {
    return extendParams;
  }

  const modelExtendParamOptions = aiModelSelectors.modelExtendParamOptions(
    model,
    provider,
  )(aiInfraStoreState);

  // Reasoning configuration
  if (modelExtendParams.includes('enableReasoning')) {
    const enableReasoningOptions = modelExtendParamOptions?.enableReasoning;
    const enableReasoning = resolveEnableReasoningValue(
      chatConfig,
      enableReasoningOptions?.defaultValue,
    );
    const includeBudget = enableReasoningOptions?.includeBudget !== false;

    if (enableReasoning) {
      const thinking: NonNullable<ModelExtendParams['thinking']> = {
        type: 'enabled',
      };

      if (includeBudget) {
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
      }

      extendParams.thinking = thinking;
    } else {
      const thinking: NonNullable<ModelExtendParams['thinking']> = {
        type: 'disabled',
      };

      if (includeBudget) {
        thinking.budget_tokens = 0;
      }

      extendParams.thinking = thinking;
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

  if (
    modelExtendParams.includes('deepseekV4ReasoningEffort') &&
    chatConfig.deepseekV4ReasoningEffort
  ) {
    extendParams.reasoning_effort = chatConfig.deepseekV4ReasoningEffort;
  }

  if (modelExtendParams.includes('codexMaxReasoningEffort') && chatConfig.codexMaxReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.codexMaxReasoningEffort;
  }

  if (modelExtendParams.includes('effort') && chatConfig.effort) {
    extendParams.effort = chatConfig.effort;
  }

  if (modelExtendParams.includes('opus47Effort') && chatConfig.opus47Effort) {
    extendParams.effort = chatConfig.opus47Effort;
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

  const supportedThinkingLevelParams = modelExtendParams.filter(
    (extendParam): extendParam is keyof typeof THINKING_LEVEL_PARAM_TO_CONFIG_KEY =>
      extendParam in THINKING_LEVEL_PARAM_TO_CONFIG_KEY,
  );

  for (const supportedThinkingLevelParam of supportedThinkingLevelParams) {
    const configKey = THINKING_LEVEL_PARAM_TO_CONFIG_KEY[supportedThinkingLevelParam];
    const value = chatConfig[configKey];

    if (typeof value === 'string') {
      extendParams.thinkingLevel = value;
      break;
    }
  }

  if (!extendParams.thinkingLevel && supportedThinkingLevelParams.length > 0) {
    extendParams.thinkingLevel =
      DEFAULT_THINKING_LEVEL_BY_EXTEND_PARAM[supportedThinkingLevelParams[0]];
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
