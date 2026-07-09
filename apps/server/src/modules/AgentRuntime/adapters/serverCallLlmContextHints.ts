import { type CallLLMPayload, stripAssistantReasoningForReplay } from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import {
  applyModelExtendParams,
  isDeepSeekThinkingEligibleModel,
  isDeepSeekV4FamilyModel,
  isKimiAlwaysPreserveThinkingModel,
  type ModelExtendParams,
} from '@lobechat/model-runtime';
import type { UIChatMessage } from '@lobechat/types';
import { type ExtendParamsType, ModelProvider } from 'model-bank';

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
  resolvedExtendParams?: ModelExtendParams;
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

  // Custom/remote user models aren't in the bundled model bank, so both cards
  // miss. Fall back to the user's own AI model record so server-side runs still
  // surface identity (the inbox `{{model}}` fallback no longer exists).
  if (!modelDisplayName && ctx.serverDB && ctx.userId) {
    try {
      const aiModelModel = new AiModelModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const userModel = await aiModelModel.findByIdAndProvider(model, provider);
      modelDisplayName = userModel?.displayName ?? undefined;
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
    isDeepSeekV4FamilyModel(model) && agentConfig?.chatConfig?.deepseekV4ReasoningEffort === 'none';
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

  const resolvedExtendParams = agentConfig?.chatConfig
    ? applyModelExtendParams({
        chatConfig: agentConfig.chatConfig,
        extendParams: modelExtendParams as ExtendParamsType[] | undefined,
        model,
      })
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
