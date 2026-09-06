import { type CallLLMPayload, stripAssistantReasoningForReplay } from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import {
  applyModelExtendParams,
  isDeepSeekThinkingEligibleModel,
  isDeepSeekV4FamilyModel,
  isKimiAlwaysPreserveThinkingModel,
  type ModelExtendParams,
  resolveEffectiveReasoningChatConfig,
} from '@lobechat/model-runtime';
import type { LobeAgentChatConfig, UIChatMessage } from '@lobechat/types';
import {
  type AiModelReasoningConfig,
  type ExtendParamsType,
  type LobeDefaultAiModelListItem,
  MODEL_REASONING_EXTEND_PARAMS,
  ModelProvider,
} from 'model-bank';

import { AiModelModel } from '@/database/models/aiModel';
import { TopicModel } from '@/database/models/topic';

import type { RuntimeExecutorContext } from '../context';
import { log } from '../executorHelpers';

interface ResolveServerCallLlmContextHintsInput {
  ctx: RuntimeExecutorContext;
  llmPayload: CallLLMPayload;
  model: string;
  provider: string;
}

export interface ServerCallLlmContextHints {
  capabilities: {
    isCanUseAudio: (model: string, provider: string) => boolean;
    isCanUseFC: (model: string, provider: string) => boolean;
    isCanUseVideo: (model: string, provider: string) => boolean;
    isCanUseVision: (model: string, provider: string) => boolean;
  };
  messagesForContext: UIChatMessage[];
  modelDisplayName?: string;
  modelKnowledgeCutoff?: string;
  preserveThinkingForPayload?: boolean;
  resolvedExtendParams?: ModelExtendParams & { enabledSearch?: boolean };
  shouldReplayAssistantReasoning: boolean;
}

export interface ResolvedModelExtendParams {
  /** Bundled card matched by id across any provider (aggregation fallback). */
  canonicalModelCard?: LobeDefaultAiModelListItem;
  /** Bundled card for exactly `provider`/`model`. */
  modelCard?: LobeDefaultAiModelListItem;
  /** Effective extend params: user row → provider card → canonical card. */
  modelExtendParams?: string[];
  /** True when any effort-family / reasoningMode param is among `modelExtendParams`. */
  modelHasReasoningExtendParams: boolean;
  userModelRow?: Awaited<ReturnType<AiModelModel['findByIdAndProvider']>>;
}

/**
 * Resolve which extend params a model can consume for this user, matching the
 * client's `getEnabledModels` merge. Shared by the per-attempt LLM hints and
 * the topic-creation reasoning snapshot (`turnSetup`), so both agree on
 * whether a model is governed by the reasoning extend-params family.
 */
export const resolveModelExtendParamsForUser = async ({
  aiModelModel,
  builtinModels: preloadedModels,
  model,
  provider,
}: {
  aiModelModel: AiModelModel | undefined;
  /** Already-loaded model bank; callers on a hot path pass it to avoid a second load. */
  builtinModels?: LobeDefaultAiModelListItem[];
  model: string;
  provider: string;
}): Promise<ResolvedModelExtendParams> => {
  const builtinModels =
    preloadedModels ??
    (await (await import('@/business/client/model-bank/loadModels')).loadModels());

  const readExtendParams = (card: LobeDefaultAiModelListItem | undefined): string[] | undefined =>
    card &&
    'settings' in card &&
    card.settings &&
    typeof card.settings === 'object' &&
    'extendParams' in card.settings
      ? (card.settings as { extendParams?: string[] }).extendParams
      : undefined;

  const modelCard = builtinModels.find(
    (item) =>
      item.providerId === provider && (item.id === model || item.config?.deploymentName === model),
  );
  const canonicalModelCard = builtinModels.find(
    (item) => item.id === model || item.config?.deploymentName === model,
  );

  // The user's own AI model row serves two purposes: custom/remote models miss
  // both bundled cards entirely (displayName + extendParams live only on the
  // row), and builtin models may carry user-edited `settings.extendParams`
  // from a provider-settings edit, which the client honors by merging user
  // settings over the card. One indexed read per attempt.
  let userModelRow: Awaited<ReturnType<AiModelModel['findByIdAndProvider']>> | undefined;
  if (aiModelModel) {
    try {
      userModelRow = await aiModelModel.findByIdAndProvider(model, provider);
    } catch (error) {
      log('Failed to resolve user model row for %s: %O', model, error);
    }
  }

  // User-edited settings win over the bundled card, matching the client's
  // `getEnabledModels` settings merge (arrays replace wholesale there, so an
  // explicit empty array is an opt-out from the card's params, not a miss —
  // only a row without `extendParams` falls back to the cards).
  let modelExtendParams: string[] | undefined = userModelRow?.settings?.extendParams ?? undefined;

  if (modelExtendParams === undefined) {
    modelExtendParams = readExtendParams(modelCard);

    // Aggregation providers (e.g. `lobehub`) may serve a model without copying
    // its origin `settings.extendParams`. Fall back to the canonical model card
    // (matched by id across any provider) so reasoning/thinking params like
    // `thinkingLevel` still reach the model. Mirrors the client-side
    // `transformToAiModelList` re-namespacing behavior.
    if (!modelExtendParams || modelExtendParams.length === 0) {
      modelExtendParams = readExtendParams(canonicalModelCard);
    }
  }

  const modelHasReasoningExtendParams = (modelExtendParams ?? []).some((param) =>
    (MODEL_REASONING_EXTEND_PARAMS as readonly string[]).includes(param),
  );

  return {
    canonicalModelCard,
    modelCard,
    modelExtendParams,
    modelHasReasoningExtendParams,
    userModelRow,
  };
};

export const resolveServerCallLlmContextHints = async ({
  ctx,
  llmPayload,
  model,
  provider,
}: ResolveServerCallLlmContextHintsInput): Promise<ServerCallLlmContextHints> => {
  const agentConfig = ctx.agentConfig;
  const { loadModels } = await import('@/business/client/model-bank/loadModels');
  const builtinModels = await loadModels();

  const preserveThinkingConfigured =
    typeof agentConfig?.chatConfig?.preserveThinking === 'boolean'
      ? agentConfig.chatConfig.preserveThinking
      : undefined;
  const preserveThinkingRequested = preserveThinkingConfigured === true;

  const aiModelModel =
    ctx.serverDB && ctx.userId
      ? new AiModelModel(ctx.serverDB, ctx.userId, ctx.workspaceId)
      : undefined;

  const {
    canonicalModelCard,
    modelCard,
    modelExtendParams,
    modelHasReasoningExtendParams,
    userModelRow,
  } = await resolveModelExtendParamsForUser({ aiModelModel, builtinModels, model, provider });

  const modelKnowledgeCutoff =
    modelCard?.knowledgeCutoff ??
    (provider === ModelProvider.LobeHub ? canonicalModelCard?.knowledgeCutoff : undefined);
  // User-set displayName wins, matching the client list merge
  const modelDisplayName =
    userModelRow?.displayName ??
    modelCard?.displayName ??
    (provider === ModelProvider.LobeHub ? canonicalModelCard?.displayName : undefined);

  // Reasoning fields (effort family + reasoningMode) resolve as: topic pin →
  // user-level model-instance config (personal scope, cross-workspace).
  // Same-named agent chatConfig values are ignored — except explicit sub-agent
  // overrides, which stay honored.
  //
  // The topic pin (`topics.metadata.reasoningConfig`, snapshotted on creation
  // and rewritten when the user changes effort / switches model while the
  // topic is active) only counts when the topic's pinned model IS the model of
  // this attempt: a sub-agent `modelOverride` or a stale snapshot must not
  // leak another model's effort. Mirrors the client `modelParamsResolver`.
  //
  // Only read either source when the model can actually consume it
  // (applyModelExtendParams ignores it otherwise) — this runs on every server
  // LLM attempt, so non-reasoning models must not pay the extra DB reads.
  let modelReasoningConfig: AiModelReasoningConfig | undefined;
  if (aiModelModel && modelHasReasoningExtendParams) {
    if (ctx.topicId && ctx.serverDB && ctx.userId) {
      try {
        // Share-visitor runs execute in the owner's context against topics that
        // carry a `senderId`; `findById` skips those rows unless opted in, and
        // the fallback would silently drop the visitor topic's pin.
        const topic = await new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId, undefined, {
          includeShareVisitor: true,
        }).findById(ctx.topicId);
        if (
          topic?.model === model &&
          topic.provider === provider &&
          (!topic.groupId || topic.agentId === ctx.agentConfig?.id)
        ) {
          modelReasoningConfig = topic.metadata?.reasoningConfig;
        }
      } catch (error) {
        log('Failed to resolve topic reasoning pin for %s: %O', ctx.topicId, error);
      }
    }
    if (!modelReasoningConfig) {
      try {
        modelReasoningConfig = await aiModelModel.getModelReasoningConfig(model, provider);
      } catch (error) {
        log('Failed to resolve model reasoning config for %s: %O', model, error);
      }
    }
  }

  const agentChatConfig: LobeAgentChatConfig | undefined = agentConfig?.chatConfig;
  const subAgentChatConfigOverride: Partial<LobeAgentChatConfig> | undefined =
    agentConfig?.subAgentChatConfigOverride ?? undefined;
  const effectiveChatConfig =
    agentChatConfig || modelReasoningConfig || subAgentChatConfigOverride
      ? resolveEffectiveReasoningChatConfig({
          agentChatConfig: agentChatConfig ?? {},
          modelReasoningConfig,
          subAgentReasoningOverrides: subAgentChatConfigOverride,
        })
      : undefined;

  const modelSupportsPreserveThinkingFromCard =
    Array.isArray(modelExtendParams) && modelExtendParams.includes('preserveThinking');
  // Kimi K2.7+ Code has preserved thinking always active and cannot opt out.
  const kimiForcesPreserveThinking =
    (provider === 'moonshot' || provider === BRANDING_PROVIDER) &&
    isKimiAlwaysPreserveThinkingModel(model);
  // DeepSeek V4 / reasoner thinking models MUST replay the real assistant
  // reasoning in history — this is mandatory, not opt-in. Their
  // Anthropic-compatible API rejects an assistant tool-call turn whose
  // thinking block is missing (HTTP 400), so stripping reasoning leaves the
  // payload builder no choice but to emit a whitespace-only placeholder
  // thinking block. Under large agentic context that degenerate history makes
  // the model emit its final answer *inside* the thinking block with empty
  // visible text (controlled replay: ~30% answer-in-thinking with the
  // placeholder vs ~2.5% when the genuine reasoning is replayed). The only
  // opt-out is a V4 model whose thinking the user explicitly disabled via
  // `deepseekV4ReasoningEffort` / `deepseekV4GAReasoningEffort` `'none'`.
  // Those flags are V4-specific and may linger on an agent after switching
  // models, so they must NOT suppress replay for `deepseek-reasoner`, which
  // is thinking-only and always forces reasoning history in the payload
  // builder — suppressing it there would reintroduce the 400/answer-hidden
  // behavior.
  const deepseekV4ThinkingDisabled =
    isDeepSeekV4FamilyModel(model) &&
    (effectiveChatConfig?.deepseekV4GAReasoningEffort === 'none' ||
      effectiveChatConfig?.deepseekV4ReasoningEffort === 'none');
  const deepseekForcesPreserveThinking =
    isDeepSeekThinkingEligibleModel(model) && !deepseekV4ThinkingDisabled;
  /**
   * Meta always uses Responses with stateless encrypted reasoning replay. This
   * opaque continuation state must survive history building and agent tool loops,
   * independently of the user's optional visible-thinking preservation setting.
   * The model runtime still validates the replay scope before sending the state.
   * @see https://dev.meta.ai/docs/features/responses#reasoning-items
   */
  const metaForcesPreserveThinking = provider === ModelProvider.Meta;
  const modelForcesPreserveThinking =
    kimiForcesPreserveThinking || deepseekForcesPreserveThinking || metaForcesPreserveThinking;
  const providerSupportsPreserveThinkingFallback =
    provider === 'qwen' || provider === 'zhipu' || provider === 'moonshot';
  const modelSupportsPreserveThinking =
    modelForcesPreserveThinking ||
    modelSupportsPreserveThinkingFromCard ||
    (!modelCard && providerSupportsPreserveThinkingFallback);

  const shouldReplayAssistantReasoning =
    (modelForcesPreserveThinking || preserveThinkingRequested) && modelSupportsPreserveThinking;
  const preserveThinkingForPayload = modelForcesPreserveThinking
    ? true
    : modelSupportsPreserveThinking && typeof preserveThinkingConfigured === 'boolean'
      ? preserveThinkingConfigured
      : undefined;

  const resolvedModelExtendParams = effectiveChatConfig
    ? applyModelExtendParams({
        chatConfig: effectiveChatConfig,
        extendParams: modelExtendParams as ExtendParamsType[] | undefined,
        model,
      })
    : undefined;
  const searchDecision = ctx.searchDecision;
  const enabledSearch =
    searchDecision?.enabledSearch && searchDecision.useModelSearch ? true : undefined;
  const resolvedExtendParams =
    resolvedModelExtendParams || enabledSearch
      ? {
          ...resolvedModelExtendParams,
          ...(enabledSearch && { enabledSearch }),
        }
      : undefined;

  const messagesForContext = shouldReplayAssistantReasoning
    ? (llmPayload.messages as UIChatMessage[])
    : stripAssistantReasoningForReplay(llmPayload.messages as UIChatMessage[]);

  const findModelInfo = (targetModel: string, targetProvider: string) =>
    builtinModels.find((item) => item.id === targetModel && item.providerId === targetProvider) ??
    builtinModels.find((item) => item.id === targetModel);

  return {
    capabilities: {
      isCanUseAudio: (targetModel, targetProvider) =>
        findModelInfo(targetModel, targetProvider)?.abilities?.audio ?? false,
      isCanUseFC: (targetModel, targetProvider) =>
        builtinModels.find((item) => item.id === targetModel && item.providerId === targetProvider)
          ?.abilities?.functionCall ?? true,
      isCanUseVideo: (targetModel, targetProvider) =>
        findModelInfo(targetModel, targetProvider)?.abilities?.video ?? false,
      isCanUseVision: (targetModel, targetProvider) =>
        findModelInfo(targetModel, targetProvider)?.abilities?.vision ?? false,
    },
    messagesForContext,
    modelDisplayName,
    modelKnowledgeCutoff,
    preserveThinkingForPayload,
    resolvedExtendParams,
    shouldReplayAssistantReasoning,
  };
};
