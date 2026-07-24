import type { LobeAgentChatConfig } from '@lobechat/types';
import type { ExtendParamsType } from 'model-bank';

/**
 * Extended parameters for model runtime
 */
export interface ModelExtendParams {
  deepseekV4ReasoningEffort?: string;
  effort?: string;
  enabledContextCaching?: boolean;
  imageAspectRatio?: string;
  imageResolution?: string;
  preserveThinking?: boolean;
  reasoning?: {
    mode?: 'standard' | 'pro';
  };
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

type ThinkingLevelExtendParam =
  'thinkingLevel' | 'thinkingLevel2' | 'thinkingLevel3' | 'thinkingLevel4';

type ThinkingLevelValue = NonNullable<LobeAgentChatConfig['thinkingLevel']>;

const DEFAULT_THINKING_LEVEL_BY_EXTEND_PARAM = {
  thinkingLevel: 'high',
  thinkingLevel2: 'high',
  thinkingLevel3: 'high',
  thinkingLevel4: 'minimal',
} as const satisfies Record<ThinkingLevelExtendParam, ThinkingLevelValue>;

const MODEL_THINKING_LEVEL_DEFAULTS: Partial<
  Record<string, Partial<Record<ThinkingLevelExtendParam, ThinkingLevelValue>>>
> = {
  'gemini-flash-latest': {
    thinkingLevel: 'medium',
  },
  'gemini-flash-lite-latest': {
    thinkingLevel: 'minimal',
  },
  'gemini-3.6-flash': {
    thinkingLevel: 'medium',
  },
  'gemini-3.5-flash': {
    thinkingLevel: 'medium',
  },
  'gemini-3.5-flash-lite': {
    thinkingLevel: 'minimal',
  },
  'gemini-3.1-flash-lite': {
    thinkingLevel: 'minimal',
  },
  'gemini-3.1-flash-lite-preview': {
    thinkingLevel: 'minimal',
  },
} as const;

const MODEL_ENABLE_ADAPTIVE_THINKING_DEFAULTS: Partial<Record<string, boolean>> = {
  'claude-sonnet-5': true,
} as const;

/**
 * Preserves legacy `thinking` preferences for users created before `enableReasoning`.
 * Without this fallback, an old `thinking: 'enabled'` or `thinking: 'disabled'`
 * setting would be treated as unset by models that now expose the `enableReasoning` switch.
 */
const resolveEnableReasoningValue = (chatConfig: LobeAgentChatConfig): boolean | undefined => {
  if (Object.hasOwn(chatConfig, 'enableReasoning')) return chatConfig.enableReasoning;

  if (chatConfig.thinking === 'enabled') return true;
  if (chatConfig.thinking === 'disabled') return false;

  return undefined;
};

const resolveThinkingLevelDefault = (
  model: string,
  extendParam: ThinkingLevelExtendParam,
): ThinkingLevelValue => {
  return (
    MODEL_THINKING_LEVEL_DEFAULTS[model]?.[extendParam] ??
    DEFAULT_THINKING_LEVEL_BY_EXTEND_PARAM[extendParam]
  );
};

const isThinkingLevelExtendParam = (
  extendParam: ExtendParamsType,
): extendParam is ThinkingLevelExtendParam => extendParam in DEFAULT_THINKING_LEVEL_BY_EXTEND_PARAM;

export const resolveDefaultThinkingLevelForModel = (model?: string): ThinkingLevelValue => {
  if (!model) return DEFAULT_THINKING_LEVEL_BY_EXTEND_PARAM.thinkingLevel;

  return resolveThinkingLevelDefault(model, 'thinkingLevel');
};

export const resolveDefaultEnableAdaptiveThinkingForModel = (
  model?: string,
): boolean | undefined => {
  if (!model) return;

  return MODEL_ENABLE_ADAPTIVE_THINKING_DEFAULTS[model];
};

export interface ApplyModelExtendParamsContext {
  chatConfig: LobeAgentChatConfig;
  /**
   * The model's supported extend params (`settings.extendParams` from its model card).
   */
  extendParams: ExtendParamsType[] | undefined;
  model: string;
}

/**
 * Resolves extended runtime parameters from a model's supported `extendParams`
 * list and the agent chat config.
 *
 * This is the provider/store-agnostic core shared by the client chat service
 * (`resolveModelExtendParams`) and the server-side agent runtime, so both paths
 * forward the same runtime params (thinking level, reasoning effort, url context, …)
 * to the model. Callers are responsible for looking up the `extendParams` list.
 */
export const applyModelExtendParams = (ctx: ApplyModelExtendParamsContext): ModelExtendParams => {
  const { extendParams: modelExtendParams, chatConfig, model } = ctx;
  const extendParams: ModelExtendParams = {};

  if (!modelExtendParams || modelExtendParams.length === 0) {
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

  // Adaptive thinking
  if (modelExtendParams.includes('enableAdaptiveThinking')) {
    if (chatConfig.enableAdaptiveThinking) {
      extendParams.thinking = {
        type: 'adaptive',
      };
    } else if (
      Object.hasOwn(chatConfig, 'enableAdaptiveThinking') &&
      chatConfig.enableAdaptiveThinking === false &&
      !modelExtendParams.includes('enableReasoning')
    ) {
      // Claude Sonnet 5 defaults adaptive thinking on; fresh configs used to
      // serialize as `{ thinking: { type: 'disabled' } }` and override that.
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

  if (modelExtendParams.includes('gpt5_6ReasoningEffort') && chatConfig.gpt5_6ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.gpt5_6ReasoningEffort;
  }

  if (modelExtendParams.includes('reasoningMode') && chatConfig.reasoningMode === 'pro') {
    extendParams.reasoning = { ...extendParams.reasoning, mode: 'pro' };
  }

  if (
    modelExtendParams.includes('gpt5_2ProReasoningEffort') &&
    chatConfig.gpt5_2ProReasoningEffort
  ) {
    extendParams.reasoning_effort = chatConfig.gpt5_2ProReasoningEffort;
  }

  if (modelExtendParams.includes('glm5_2ReasoningEffort') && chatConfig.glm5_2ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.glm5_2ReasoningEffort;
  }

  if (modelExtendParams.includes('grok4_20ReasoningEffort') && chatConfig.grok4_20ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.grok4_20ReasoningEffort;
  }

  if (modelExtendParams.includes('grok4_3ReasoningEffort') && chatConfig.grok4_3ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.grok4_3ReasoningEffort;
  }

  if (modelExtendParams.includes('grok4_5ReasoningEffort') && chatConfig.grok4_5ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.grok4_5ReasoningEffort;
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
          ...extendParams.thinking,
          type: 'disabled',
        };
      } else {
        extendParams.reasoning_effort = deepseekV4ReasoningEffort;
        extendParams.thinking = {
          ...extendParams.thinking,
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
