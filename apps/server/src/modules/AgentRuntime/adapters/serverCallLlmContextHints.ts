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
  MODEL_REASONING_EXTEND_PARAMS,
  ModelProvider,
} from 'model-bank';

import { AiModelModel } from '@/database/models/aiModel';

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

  const readExtendParams = (
    card: (typeof builtinModels)[number] | undefined,
  ): string[] | undefined =>
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
  const modelKnowledgeCutoff =
    modelCard?.knowledgeCutoff ??
    (provider === ModelProvider.LobeHub ? canonicalModelCard?.knowledgeCutoff : undefined);
  let modelDisplayName =
    modelCard?.displayName ??
    (provider === ModelProvider.LobeHub ? canonicalModelCard?.displayName : undefined);

  const aiModelModel =
    ctx.serverDB && ctx.userId
      ? new AiModelModel(ctx.serverDB, ctx.userId, ctx.workspaceId)
      : undefined;

  // Custom/remote user models aren't in the bundled model bank, so both cards
  // miss. Fall back to the user's own AI model record so server-side runs still
  // surface identity (the inbox `{{model}}` fallback no longer exists).
  let userModelRow: Awaited<ReturnType<AiModelModel['findByIdAndProvider']>> | undefined;
  if (!modelDisplayName && aiModelModel) {
    try {
      userModelRow = await aiModelModel.findByIdAndProvider(model, provider);
      modelDisplayName = userModelRow?.displayName ?? undefined;
    } catch (error) {
      log('Failed to resolve user model display name for %s: %O', model, error);
    }
  }

  let modelExtendParams = readExtendParams(modelCard);

  // Aggregation providers (e.g. `lobehub`) may serve a model without copying
  // its origin `settings.extendParams`. Fall back to the canonical model card
  // (matched by id across any provider) so reasoning/thinking params like
  // `thinkingLevel` still reach the model. Mirrors the client-side
  // `transformToAiModelList` re-namespacing behavior.
  if (!modelExtendParams || modelExtendParams.length === 0) {
    modelExtendParams = readExtendParams(canonicalModelCard);
  }

  // Custom/remote user models miss both cards; their extend params live on the
  // user's own DB row (`settings.extendParams`). Reuse the row already fetched
  // for the displayName fallback — no extra read on the hot path.
  if ((!modelExtendParams || modelExtendParams.length === 0) && userModelRow) {
    modelExtendParams = userModelRow.settings?.extendParams;
  }

  // Reasoning fields (effort family + reasoningMode) are user-level
  // model-instance settings (personal scope, cross-workspace): same-named
  // agent chatConfig values are ignored and the saved per-model config applies
  // instead — except explicit sub-agent overrides, which stay honored.
  // Only read the saved config when the model can actually consume it
  // (applyModelExtendParams ignores it otherwise) — this runs on every server
  // LLM attempt, so non-reasoning models must not pay the extra DB read.
  const modelHasReasoningExtendParams = (modelExtendParams ?? []).some((param) =>
    (MODEL_REASONING_EXTEND_PARAMS as readonly string[]).includes(param),
  );
  let modelReasoningConfig: AiModelReasoningConfig | undefined;
  if (aiModelModel && modelHasReasoningExtendParams) {
    try {
      modelReasoningConfig = await aiModelModel.getModelReasoningConfig(model, provider);
    } catch (error) {
      log('Failed to resolve model reasoning config for %s: %O', model, error);
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
  // `deepseekV4ReasoningEffort: 'none'`. That flag is V4-specific and may
  // linger on an agent after switching models, so it must NOT suppress
  // replay for `deepseek-reasoner`, which is thinking-only and always
  // forces reasoning history in the payload builder — suppressing it there
  // would reintroduce the 400/answer-hidden behavior.
  const deepseekV4ThinkingDisabled =
    isDeepSeekV4FamilyModel(model) && effectiveChatConfig?.deepseekV4ReasoningEffort === 'none';
  const deepseekForcesPreserveThinking =
    isDeepSeekThinkingEligibleModel(model) && !deepseekV4ThinkingDisabled;
  const modelForcesPreserveThinking = kimiForcesPreserveThinking || deepseekForcesPreserveThinking;
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
