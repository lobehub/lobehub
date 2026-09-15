import { BRANDING_PROVIDER } from '@lobechat/business-const/branding';
import {
  isDeepSeekThinkingEligibleModel,
  isDeepSeekV4FamilyModel,
} from '@lobechat/model-runtime/providers/deepseek/modelId';
import { isKimiAlwaysPreserveThinkingModel } from '@lobechat/model-runtime/providers/moonshot/modelId';
import {
  applyModelExtendParams,
  resolveEffectiveReasoningChatConfig,
} from '@lobechat/model-runtime/utils/modelExtendParams';
import type { LobeAgentChatConfig } from '@lobechat/types';
import debug from 'debug';
import {
  type AiModelReasoningConfig,
  type ExtendParamsType,
  MODEL_REASONING_EXTEND_PARAMS,
} from 'model-bank';
import { ModelProvider } from 'model-bank/modelProvider';

import type {
  MediaCapabilities,
  ModelCardFacts,
  ModelParamsProviders,
  ModelParamsRequest,
  ResolvedModelExtendParamList,
  ResolvedModelParams,
} from './types';

const log = debug('mecha:modelParams');

const REASONING_EXTEND_PARAMS = MODEL_REASONING_EXTEND_PARAMS as readonly string[];

const attempt = async <T>(
  label: string,
  run: () => Promise<T | null | undefined> | T | null | undefined,
): Promise<T | undefined> => {
  try {
    return (await run()) ?? undefined;
  } catch (error) {
    log('%s failed (non-fatal): %O', label, error);
    return undefined;
  }
};

const matchesModel = (card: ModelCardFacts, model: string) =>
  card.id === model || card.deploymentName === model;

/**
 * Agent config stores the number of history messages, excluding the current
 * turn. The runtime already carries the current user / tool turn, so without
 * the +1 a `historyCount` of 0 would truncate the current message too. An
 * unset value means no truncation at all.
 */
export const resolveHistoryCount = (historyCount?: number | null): number | undefined =>
  typeof historyCount === 'number' ? historyCount + 1 : undefined;

/**
 * Which extend params the model can consume for this user: the user's own
 * row (an explicit empty array opts out), else the provider's card, else the
 * canonical card matched by id across providers — aggregation providers may
 * serve a model without copying its origin `settings.extendParams`.
 */
export const resolveModelExtendParamList = async (
  request: Pick<ModelParamsRequest, 'model' | 'provider'>,
  providers: ModelParamsProviders,
): Promise<ResolvedModelExtendParamList> => {
  const { model, provider } = request;
  const cards = providers.listModelCards();
  const modelCard = cards.find((card) => card.providerId === provider && matchesModel(card, model));
  // The origin card of the same model under another provider; aggregation
  // providers may serve it without copying its settings.
  const canonicalModelCard =
    cards.find((card) => card.providerId !== provider && matchesModel(card, model)) ??
    cards.find((card) => matchesModel(card, model));
  const userModelRow = await attempt('userModelRow', () =>
    providers.getUserModelRow?.(model, provider),
  );

  let modelExtendParams = userModelRow?.extendParams ?? undefined;
  if (modelExtendParams === undefined) {
    modelExtendParams = modelCard?.extendParams ?? undefined;
    if (!modelExtendParams || modelExtendParams.length === 0) {
      modelExtendParams = canonicalModelCard?.extendParams ?? undefined;
    }
  }

  return {
    canonicalModelCard,
    modelCard,
    modelExtendParams,
    modelHasReasoningExtendParams: (modelExtendParams ?? []).some((param) =>
      REASONING_EXTEND_PARAMS.includes(param),
    ),
    userModelRow,
  };
};

/**
 * Reasoning fields resolve as: topic pin → user-level model-instance config.
 * The pin only counts when the topic pinned exactly this model (a sub-agent
 * `modelOverride` or a stale snapshot must not leak another model's effort)
 * and, in a group topic, when it belongs to the agent that is answering.
 */
const resolveReasoningConfig = async (
  request: ModelParamsRequest,
  providers: ModelParamsProviders,
): Promise<AiModelReasoningConfig | undefined> => {
  const { model, provider, topicId } = request;
  if (topicId && providers.findTopicReasoningPin) {
    const { findTopicReasoningPin } = providers;
    const pin = await attempt('topicReasoningPin', () => findTopicReasoningPin(topicId));
    // An empty pin is a pin (the model defaults); a legacy topic without one
    // follows the user-level config until the user pins something.
    if (
      pin?.model === model &&
      pin.provider === provider &&
      (!pin.groupId || pin.agentId === request.agent.id) &&
      pin.reasoningConfig
    ) {
      return pin.reasoningConfig;
    }
  }
  return attempt('modelReasoningConfig', () =>
    providers.getModelReasoningConfig?.(model, provider),
  );
};

const isNonEmptyRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;

/**
 * Decide the model parameters of an LLM call from the agent's chat config,
 * the model's cards and the user's per-model settings. The rules — what a
 * model can consume, where reasoning effort comes from, when assistant
 * reasoning must be replayed, what capabilities the context may assume —
 * live here for every host; hosts only answer the lookups.
 */
export const resolveModelParams = async (
  request: ModelParamsRequest,
  providers: ModelParamsProviders,
): Promise<ResolvedModelParams> => {
  const { model, provider } = request;
  const chatConfig: LobeAgentChatConfig | undefined = request.agent.chatConfig ?? undefined;
  const extendParamList = await resolveModelExtendParamList(request, providers);
  const {
    canonicalModelCard,
    modelCard,
    modelExtendParams,
    modelHasReasoningExtendParams,
    userModelRow,
  } = extendParamList;

  const modelKnowledgeCutoff =
    modelCard?.knowledgeCutoff ??
    (provider === ModelProvider.LobeHub ? canonicalModelCard?.knowledgeCutoff : undefined) ??
    undefined;
  // A user-set display name wins, matching the client list merge.
  const modelDisplayName =
    userModelRow?.displayName ??
    modelCard?.displayName ??
    (provider === ModelProvider.LobeHub ? canonicalModelCard?.displayName : undefined) ??
    undefined;

  // Only read the reasoning sources when the model can actually consume them
  // (`applyModelExtendParams` ignores them otherwise) — this runs on every
  // LLM attempt, so non-reasoning models must not pay the extra reads.
  const modelReasoningConfig = modelHasReasoningExtendParams
    ? await resolveReasoningConfig(request, providers)
    : undefined;

  const subAgentChatConfigOverride = request.agent.subAgentChatConfigOverride ?? undefined;
  const effectiveChatConfig =
    chatConfig || modelReasoningConfig || subAgentChatConfigOverride
      ? resolveEffectiveReasoningChatConfig({
          agentChatConfig: chatConfig ?? {},
          modelReasoningConfig,
          subAgentReasoningOverrides: subAgentChatConfigOverride,
        })
      : undefined;

  const preserveThinkingConfigured =
    typeof chatConfig?.preserveThinking === 'boolean' ? chatConfig.preserveThinking : undefined;
  const modelSupportsPreserveThinkingFromCard =
    Array.isArray(modelExtendParams) && modelExtendParams.includes('preserveThinking');
  // Kimi K2.7+ Code has preserved thinking always active and cannot opt out.
  const kimiForcesPreserveThinking =
    (provider === 'moonshot' || provider === BRANDING_PROVIDER) &&
    isKimiAlwaysPreserveThinkingModel(model);
  // DeepSeek V4 / reasoner thinking models MUST replay the real assistant
  // reasoning: their Anthropic-compatible API rejects an assistant tool-call
  // turn whose thinking block is missing, and a placeholder block makes the
  // model answer inside its thinking. The only opt-out is a V4 model whose
  // thinking the user explicitly disabled; those flags are V4-specific and
  // must not suppress replay for the thinking-only `deepseek-reasoner`.
  const deepseekV4ThinkingDisabled =
    isDeepSeekV4FamilyModel(model) &&
    (effectiveChatConfig?.deepseekV4GAReasoningEffort === 'none' ||
      effectiveChatConfig?.deepseekV4ReasoningEffort === 'none');
  const deepseekForcesPreserveThinking =
    isDeepSeekThinkingEligibleModel(model) && !deepseekV4ThinkingDisabled;
  // Meta always uses Responses with stateless encrypted reasoning replay; the
  // opaque continuation state must survive history building and tool loops
  // independently of the user's visible-thinking preference.
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
    (modelForcesPreserveThinking || preserveThinkingConfigured === true) &&
    modelSupportsPreserveThinking;
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
  const { searchDecision } = request;
  const enabledSearch =
    searchDecision?.enabledSearch && searchDecision.useModelSearch ? true : undefined;
  const resolvedExtendParams =
    resolvedModelExtendParams || enabledSearch
      ? { ...resolvedModelExtendParams, ...(enabledSearch && { enabledSearch }) }
      : undefined;

  const cards = providers.listModelCards();
  const findCard = (targetModel: string, targetProvider: string) =>
    cards.find((card) => card.providerId === targetProvider && matchesModel(card, targetModel));
  // A non-empty user abilities object replaces the card's abilities, explicit
  // false values included; media routing and context assembly must agree or
  // native attachments are discarded.
  const findMediaCapabilities = (
    targetModel: string,
    targetProvider: string,
  ): MediaCapabilities | undefined => {
    const isAttemptModel = targetModel === model && targetProvider === provider;
    if (isAttemptModel && request.mediaCapabilities) return request.mediaCapabilities;
    const userAbilities = isAttemptModel ? userModelRow?.abilities : undefined;
    if (isNonEmptyRecord(userAbilities)) {
      return {
        audio: userAbilities.audio === true,
        video: userAbilities.video === true,
        vision: userAbilities.vision === true,
      };
    }
    return (
      (
        findCard(targetModel, targetProvider) ??
        cards.find((card) => matchesModel(card, targetModel))
      )?.abilities ?? undefined
    );
  };

  return {
    ...extendParamList,
    capabilities: {
      isCanUseAudio: (m, p) => findMediaCapabilities(m, p)?.audio ?? false,
      // Unknown metadata means "assume function calling": a missing card is a
      // timing or custom-model gap, not a capability statement.
      isCanUseFC: (m, p) => findCard(m, p)?.abilities?.functionCall ?? true,
      isCanUseVideo: (m, p) => findMediaCapabilities(m, p)?.video ?? false,
      isCanUseVision: (m, p) => findMediaCapabilities(m, p)?.vision ?? false,
    },
    enableAgentMode: chatConfig?.enableAgentMode ?? undefined,
    historyCount: resolveHistoryCount(chatConfig?.historyCount),
    modelDisplayName,
    modelKnowledgeCutoff,
    preserveThinkingForPayload,
    resolvedExtendParams,
    shouldReplayAssistantReasoning,
    stream: chatConfig?.enableStreaming !== false,
  };
};
