import type { LobeChatDatabase } from '@lobechat/database';
import type { ModelCardFacts, ModelParamsProviders, UserModelRowFacts } from '@lobechat/mecha';
import type { AiModelConfig, AiModelSettings, LobeDefaultAiModelListItem } from 'model-bank';

import { AiModelModel } from '@/database/models/aiModel';
import { TopicModel } from '@/database/models/topic';

export interface ServerModelParamsSource {
  /** Already-loaded model bank; callers on a hot path pass it to avoid a second load. */
  builtinModels: LobeDefaultAiModelListItem[];
  serverDB?: LobeChatDatabase;
  userId?: string;
  workspaceId?: string;
}

const toModelCard = (item: LobeDefaultAiModelListItem): ModelCardFacts => {
  const settings =
    'settings' in item && item.settings && typeof item.settings === 'object'
      ? (item.settings as AiModelSettings)
      : undefined;
  return {
    abilities: item.abilities,
    deploymentName: item.config?.deploymentName,
    displayName: item.displayName,
    extendParams: settings?.extendParams ?? undefined,
    id: item.id,
    knowledgeCutoff: item.knowledgeCutoff,
    providerId: item.providerId,
    reasoningEffort: settings?.reasoningEffort,
  };
};

/** The `ai_models` columns the model-parameter rules read from a user's own row. */
interface UserModelRow {
  abilities?: UserModelRowFacts['abilities'] | null;
  config?: unknown;
  displayName?: string | null;
  settings?: AiModelSettings | null;
}

/**
 * The model-parameter facts of the user's own AI model row: custom/remote
 * models miss both bundled cards entirely, and builtin models may carry
 * user-edited settings.
 */
export const toUserModelRowFacts = (row: UserModelRow): UserModelRowFacts => ({
  abilities: row.abilities ?? undefined,
  // Deployment-catalog providers resolve the request model by this alias
  // (merged over the bundled card when the facts freeze); without it the
  // transport injects the catalog default instead of the user's endpoint.
  deploymentName: (row.config as AiModelConfig | null)?.deploymentName ?? null,
  displayName: row.displayName,
  extendParams: row.settings?.extendParams ?? undefined,
  reasoningEffort: row.settings?.reasoningEffort,
});

/**
 * How the server answers the model-parameter rules: the bundled bank plus,
 * when the run has a user scope, that user's own model row, model-instance
 * reasoning config and the topic's reasoning pin.
 */
export const createServerModelParamsProviders = ({
  builtinModels,
  serverDB,
  userId,
  workspaceId,
}: ServerModelParamsSource): ModelParamsProviders => {
  const cards = builtinModels.map(toModelCard);
  const providers: ModelParamsProviders = { listModelCards: () => cards };
  if (!serverDB || !userId) return providers;

  const aiModelModel = new AiModelModel(serverDB, userId, workspaceId);
  return {
    ...providers,
    // Share-visitor runs execute in the owner's context against topics that
    // carry a `senderId`; `findById` skips those rows unless opted in, and
    // the fallback would silently drop the visitor topic's pin.
    findTopicReasoningPin: async (topicId) => {
      const topic = await new TopicModel(serverDB, userId, workspaceId, undefined, {
        includeShareVisitor: true,
      }).findById(topicId);
      if (!topic) return null;
      return {
        agentId: topic.agentId,
        groupId: topic.groupId,
        model: topic.model,
        provider: topic.provider,
        reasoningConfig: topic.metadata?.reasoningConfig,
      };
    },
    getModelReasoningConfig: (model, provider) =>
      aiModelModel.getModelReasoningConfig(model, provider),
    getUserModelRow: async (model, provider) => {
      const row = await aiModelModel.findByIdAndProvider(model, provider);
      return row ? toUserModelRowFacts(row) : null;
    },
  };
};
