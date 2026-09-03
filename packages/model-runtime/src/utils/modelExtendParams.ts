import type { LobeAgentChatConfig } from '@lobechat/types';
import type { AiModelReasoningConfig, ExtendParamsType } from 'model-bank';
import { MODEL_REASONING_EXTEND_PARAMS } from 'model-bank';

import { isAdaptiveThinkingDefaultOnModel } from '../providers/anthropic/modelId';

export interface ResolveEffectiveReasoningChatConfigContext {
  /**
   * The agent's chat config. Migrated reasoning fields (effort family +
   * reasoningMode) are stripped — since the model-instance migration they are
   * user-level per-model settings, and legacy agent values must not leak into
   * outbound payloads.
   */
  agentChatConfig: LobeAgentChatConfig;
  /**
   * The user's per-model-instance defaults (`ai_models.config.chatConfig`,
   * personal scope).
   */
  modelReasoningConfig?: AiModelReasoningConfig | null;
  /**
   * Explicit sub-agent overrides (`agencyConfig.subagent.chatConfig`). Unlike the
   * main agent, a sub-agent's reasoning fields stay honored when the user set them,
   * winning over the model-instance defaults.
   */
  subAgentReasoningOverrides?: AiModelReasoningConfig | null;
}

const pickReasoningFields = (config?: AiModelReasoningConfig | null): AiModelReasoningConfig => {
  const result: AiModelReasoningConfig = {};
  if (!config) return result;

  for (const key of MODEL_REASONING_EXTEND_PARAMS) {
    const value = config[key];
    if (value !== undefined) (result as Record<string, unknown>)[key] = value;
  }

  return result;
};

/**
 * Builds the effective chat config for reasoning-param resolution, shared by the
 * client chat service and the server agent runtime so both produce the same
 * payload: agent config without the migrated fields ← model-instance defaults ←
 * explicit sub-agent overrides. Field-level model support is still enforced by
 * `applyModelExtendParams`, which only reads fields the model card declares.
 */
export const resolveEffectiveReasoningChatConfig = (
  ctx: ResolveEffectiveReasoningChatConfigContext,
): LobeAgentChatConfig => {
  const base: LobeAgentChatConfig = { ...ctx.agentChatConfig };
  for (const key of MODEL_REASONING_EXTEND_PARAMS) delete base[key];

  return {
    ...base,
    ...pickReasoningFields(ctx.modelReasoningConfig),
    ...pickReasoningFields(ctx.subAgentReasoningOverrides),
  };
};

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
    thinkingLevel3: 'medium',
  },
  'gemini-flash-lite-latest': {
    thinkingLevel: 'minimal',
  },
  'gemini-3.6-flash': {
    thinkingLevel: 'medium',
  },
  'gemini-3.7-flash': {
    thinkingLevel: 'medium',
    thinkingLevel3: 'medium',
  },
  'gemini-3.8-flash': {
    thinkingLevel: 'medium',
    thinkingLevel3: 'medium',
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

export function resolveDefaultThinkingLevelForModel<
  T extends ThinkingLevelExtendParam = 'thinkingLevel',
>(model?: string, extendParam?: T): NonNullable<LobeAgentChatConfig[T]> {
  const param = (extendParam ?? 'thinkingLevel') as T;

  if (!model) {
    return DEFAULT_THINKING_LEVEL_BY_EXTEND_PARAM[param] as NonNullable<LobeAgentChatConfig[T]>;
  }

  return resolveThinkingLevelDefault(model, param) as NonNullable<LobeAgentChatConfig[T]>;
}

/**
 * Returns `true` for models that ship adaptive thinking on, `undefined` when the model has
 * no opinion — `false` is intentionally never returned, since it would read as an explicit
 * opt-out rather than "no default".
 */
export const resolveDefaultEnableAdaptiveThinkingForModel = (
  model?: string,
): boolean | undefined => {
  if (!model) return;

  return isAdaptiveThinkingDefaultOnModel(model) || undefined;
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
      // Claude 5 and later default adaptive thinking on; fresh configs used to
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

  if (modelExtendParams.includes('glm5_3ReasoningEffort') && chatConfig.glm5_3ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.glm5_3ReasoningEffort;
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

  if (modelExtendParams.includes('grok4_6ReasoningEffort') && chatConfig.grok4_6ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.grok4_6ReasoningEffort;
  }

  if (modelExtendParams.includes('hy3ReasoningEffort') && chatConfig.hy3ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.hy3ReasoningEffort;
  }

  if (modelExtendParams.includes('kimiK3ReasoningEffort') && chatConfig.kimiK3ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.kimiK3ReasoningEffort;
  }

  if (modelExtendParams.includes('ring2_6ReasoningEffort') && chatConfig.ring2_6ReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.ring2_6ReasoningEffort;
  }

  if (modelExtendParams.includes('codexMaxReasoningEffort') && chatConfig.codexMaxReasoningEffort) {
    extendParams.reasoning_effort = chatConfig.codexMaxReasoningEffort;
  }

  // DeepSeek reasoning effort is reconciled last to avoid invalid combinations.
  const deepseekV4ReasoningEffort = modelExtendParams.includes('deepseekV4GAReasoningEffort')
    ? chatConfig.deepseekV4GAReasoningEffort
    : modelExtendParams.includes('deepseekV4ReasoningEffort')
      ? chatConfig.deepseekV4ReasoningEffort
      : undefined;

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

  if (modelExtendParams.includes('glm5_3ReasoningEffort')) {
    // GLM-5.3 rejects thinking.type=disabled. Keep this after the generic
    // `thinking` block so a custom card that also lists `thinking` cannot
    // emit the forbidden payload.
    extendParams.thinking = { type: 'enabled' };
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
