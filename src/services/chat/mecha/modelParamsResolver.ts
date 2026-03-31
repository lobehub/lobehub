import type { LobeAgentChatConfig } from '@lobechat/types';
import type { ExtendParamsType } from 'model-bank';
import { ModelProvider } from 'model-bank';

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

  // Reasoning configuration
  if (modelExtendParams.includes('enableReasoning')) {
    if (chatConfig.enableReasoning) {
      // Determine which budget field to use based on model support
      let budgetTokens: number | undefined;
      if (modelExtendParams.includes('reasoningBudgetToken32k')) {
        budgetTokens = chatConfig.reasoningBudgetToken32k || 1024;
      } else if (modelExtendParams.includes('reasoningBudgetToken80k')) {
        budgetTokens = chatConfig.reasoningBudgetToken80k || 1024;
      } else {
        budgetTokens = chatConfig.reasoningBudgetToken || 1024;
      }
      extendParams.thinking = {
        budget_tokens: budgetTokens,
        type: 'enabled',
      };
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

  if (modelExtendParams.includes('codexMaxReasoningEffort') && chatConfig.codexMaxReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.codexMaxReasoningEffort;
  }

  if (modelExtendParams.includes('effort') && chatConfig.effort) {
    extendParams.effort = chatConfig.effort;
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

  const thinkingLevelVariants: readonly {
    allowedLevels: readonly string[];
    configKey: keyof LobeAgentChatConfig;
    extendParam: ExtendParamsType;
  }[] = [
    {
      allowedLevels: ['minimal', 'low', 'medium', 'high'],
      configKey: 'thinkingLevel5',
      extendParam: 'thinkingLevel5',
    },
    {
      allowedLevels: ['minimal', 'high'],
      configKey: 'thinkingLevel4',
      extendParam: 'thinkingLevel4',
    },
    {
      allowedLevels: ['low', 'medium', 'high'],
      configKey: 'thinkingLevel3',
      extendParam: 'thinkingLevel3',
    },
    { allowedLevels: ['low', 'high'], configKey: 'thinkingLevel2', extendParam: 'thinkingLevel2' },
  ];

  const resolveThinkingLevelFromVariant = (
    variantKey: keyof LobeAgentChatConfig,
    allowedLevels: readonly string[],
  ) => {
    const value = chatConfig[variantKey];
    if (typeof value === 'string' && allowedLevels.includes(value)) return value;
    return undefined;
  };

  // Prefer explicit variant keys when present and configured.
  for (const { configKey, extendParam, allowedLevels } of thinkingLevelVariants) {
    if (!modelExtendParams.includes(extendParam)) continue;
    const resolved = resolveThinkingLevelFromVariant(configKey, allowedLevels);
    if (resolved) {
      extendParams.thinkingLevel = resolved;
      break;
    }
  }

  // Next, use base thinkingLevel when supported.
  if (!extendParams.thinkingLevel) {
    const baseValue = chatConfig.thinkingLevel;
    if (modelExtendParams.includes('thinkingLevel') && typeof baseValue === 'string') {
      extendParams.thinkingLevel = baseValue;
    }
  }

  // Finally, backward-compatible fallback: previous UI versions wrote to `thinkingLevel`
  // even when the model expected `thinkingLevel2/3/4/5`.
  if (!extendParams.thinkingLevel) {
    const baseValue = chatConfig.thinkingLevel;
    for (const { extendParam, allowedLevels } of thinkingLevelVariants) {
      if (!modelExtendParams.includes(extendParam)) continue;
      if (typeof baseValue === 'string' && allowedLevels.includes(baseValue)) {
        extendParams.thinkingLevel = baseValue;
        break;
      }
    }
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
