import type { LobeAgentChatConfig } from '@lobechat/types';
import type {
  AiModelReasoningConfig,
  AiModelReasoningEffortSettings,
  ExtendParamsType,
} from 'model-bank/aiModel';
import { MODEL_REASONING_CONFIG_KEYS, resolveReasoningEffortLevel } from 'model-bank/aiModel';

import { isAdaptiveThinkingDefaultOnModel } from '../providers/anthropic/modelId';

export interface ResolveEffectiveReasoningChatConfigContext {
  /**
   * The agent's chat config. Migrated reasoning fields (reasoningEffort +
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

  for (const key of MODEL_REASONING_CONFIG_KEYS) {
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
  for (const key of MODEL_REASONING_CONFIG_KEYS) delete base[key];

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
  urlContext?: boolean;
  verbosity?: string;
}

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
  /**
   * The model's reasoning effort control (`settings.reasoningEffort` from its model card).
   */
  reasoningEffort?: AiModelReasoningEffortSettings;
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
  const { extendParams: modelExtendParams = [], chatConfig, reasoningEffort } = ctx;
  const extendParams: ModelExtendParams = {};

  if (modelExtendParams.length === 0 && !reasoningEffort) {
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

  // Reasoning effort is resolved last so a model that couples it with thinking
  // (`controlsThinking`) wins over the generic thinking params above.
  // When a thinking switch on the same card (enableReasoning, adaptive thinking)
  // turned thinking off and the user never picked an effort, the card default is
  // not sent: it must not switch thinking back on for models that couple the two
  // (Hunyuan's DeepSeek cards), nor pair an effort with disabled thinking. A
  // coupled model without a `none` level (GLM 5.3) cannot think off at all, so
  // its effort always applies.
  const thinkingAlwaysOn =
    !!reasoningEffort?.controlsThinking && !reasoningEffort.levels.includes('none');
  const thinkingSwitchedOff =
    !thinkingAlwaysOn && !chatConfig.reasoningEffort && extendParams.thinking?.type === 'disabled';

  if (reasoningEffort && !thinkingSwitchedOff) {
    const level = resolveReasoningEffortLevel(reasoningEffort, chatConfig.reasoningEffort);

    if (reasoningEffort.controlsThinking && level === 'none') {
      extendParams.thinking = { ...extendParams.thinking, type: 'disabled' };
    } else {
      // Every protocol reads `reasoning_effort`: Anthropic-compatible runtimes forward it as
      // `output_config.effort` and Google as `thinkingLevel`.
      extendParams.reasoning_effort = level;
      if (reasoningEffort.controlsThinking) {
        extendParams.thinking = { ...extendParams.thinking, type: 'enabled' };
      }
    }
  }

  if (modelExtendParams.includes('reasoningMode') && chatConfig.reasoningMode === 'pro') {
    extendParams.reasoning = { ...extendParams.reasoning, mode: 'pro' };
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
