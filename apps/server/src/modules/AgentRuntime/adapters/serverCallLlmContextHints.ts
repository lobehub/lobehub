import {
  type AgentWorldSnapshot,
  type CallLLMPayload,
  stripAssistantReasoningForReplay,
} from '@lobechat/agent-runtime';
import {
  createFrozenModelParamsProviders,
  type ResolvedModelExtendParamList,
  type ResolvedModelParams,
  resolveModelExtendParamList,
  resolveModelParams,
} from '@lobechat/mecha';
import type { UIChatMessage } from '@lobechat/types';
import type { LobeDefaultAiModelListItem } from 'model-bank';

import { loadModels } from '@/business/client/model-bank/loadModels';
import type { AiModelModel } from '@/database/models/aiModel';
import { createServerModelParamsProviders } from '@/server/modules/Mecha/ModelParams/providers';

import type { RuntimeExecutorContext } from '../context';

interface ResolveServerCallLlmContextHintsInput {
  ctx: RuntimeExecutorContext;
  llmPayload: CallLLMPayload;
  model: string;
  provider: string;
  world?: AgentWorldSnapshot;
}

export interface ServerCallLlmContextHints extends Pick<
  ResolvedModelParams,
  | 'capabilities'
  | 'enableAgentMode'
  | 'historyCount'
  | 'modelDisplayName'
  | 'modelKnowledgeCutoff'
  | 'preserveThinkingForPayload'
  | 'resolvedExtendParams'
  | 'shouldReplayAssistantReasoning'
  | 'stream'
> {
  messagesForContext: UIChatMessage[];
}

export type ResolvedModelExtendParams = ResolvedModelExtendParamList;

/**
 * Which extend params a model can consume for this user. Shared by the
 * per-attempt LLM hints and the topic-creation reasoning snapshot
 * (`turnSetup`), so both agree on whether a model is governed by the
 * reasoning extend-params family.
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
  const builtinModels = preloadedModels ?? (await loadModels());
  const cards = createServerModelParamsProviders({ builtinModels });
  return resolveModelExtendParamList(
    { model, provider },
    aiModelModel
      ? {
          ...cards,
          getUserModelRow: async (m, p) => {
            const row = await aiModelModel.findByIdAndProvider(m, p);
            if (!row) return null;
            return {
              abilities: row.abilities,
              displayName: row.displayName,
              extendParams: row.settings?.extendParams ?? undefined,
            };
          },
        }
      : cards,
  );
};

/**
 * The model-parameter facts of one LLM attempt. The rules live in
 * `@lobechat/mecha`; this adapter only supplies the server's lookups and the
 * run's frozen snapshots (media capabilities, search decision).
 */
export const resolveServerCallLlmContextHints = async ({
  ctx,
  llmPayload,
  model,
  provider,
  world,
}: ResolveServerCallLlmContextHintsInput): Promise<ServerCallLlmContextHints> => {
  const agentConfig = world?.agent;
  const snapshot = ctx.modelRuntimeConfig;
  // The run froze its model facts when the operation was created. Reuse them
  // for the model they were read for: the bank, the user's model row and the
  // reasoning config are then read zero times per step, and a card or effort
  // the user edits mid-run cannot change the payload between two steps. An
  // attempt on another model (a compression model), or an operation created
  // before the snapshot existed, resolves live.
  const frozenFacts =
    snapshot?.modelFacts?.model === model && snapshot.modelFacts.provider === provider
      ? snapshot.modelFacts
      : undefined;

  const resolved = await resolveModelParams(
    {
      agent: {
        chatConfig: agentConfig?.chatConfig,
        id: agentConfig?.id,
        subAgentChatConfigOverride: agentConfig?.subAgentChatConfigOverride,
      },
      // Tool discovery is fixed for the operation; keep native inputs on the
      // same snapshot across retries, settings edits and worker invocations.
      mediaCapabilities:
        frozenFacts?.mediaCapabilities ??
        (snapshot?.model === model && snapshot.provider === provider
          ? snapshot.mediaCapabilities
          : undefined),
      model,
      provider,
      searchDecision: world?.searchDecision,
      topicId: ctx.topicId,
    },
    frozenFacts
      ? createFrozenModelParamsProviders(frozenFacts)
      : createServerModelParamsProviders({
          builtinModels: await loadModels(),
          serverDB: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
  );

  const messages = llmPayload.messages as UIChatMessage[];
  return {
    capabilities: resolved.capabilities,
    enableAgentMode: resolved.enableAgentMode,
    historyCount: resolved.historyCount,
    messagesForContext: resolved.shouldReplayAssistantReasoning
      ? messages
      : stripAssistantReasoningForReplay(messages),
    modelDisplayName: resolved.modelDisplayName,
    modelKnowledgeCutoff: resolved.modelKnowledgeCutoff,
    preserveThinkingForPayload: resolved.preserveThinkingForPayload,
    resolvedExtendParams: resolved.resolvedExtendParams,
    shouldReplayAssistantReasoning: resolved.shouldReplayAssistantReasoning,
    stream: resolved.stream,
  };
};
