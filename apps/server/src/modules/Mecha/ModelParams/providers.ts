import type { LobeChatDatabase } from '@lobechat/database';
import type { ModelCardFacts, ModelParamsProviders } from '@lobechat/mecha';
import type { LobeDefaultAiModelListItem } from 'model-bank';

import { AiModelModel } from '@/database/models/aiModel';
import { TopicModel } from '@/database/models/topic';

export interface ServerModelParamsSource {
  /** Already-loaded model bank; callers on a hot path pass it to avoid a second load. */
  builtinModels: LobeDefaultAiModelListItem[];
  serverDB?: LobeChatDatabase;
  userId?: string;
  workspaceId?: string;
}

const toModelCard = (item: LobeDefaultAiModelListItem): ModelCardFacts => ({
  abilities: item.abilities,
  deploymentName: item.config?.deploymentName,
  displayName: item.displayName,
  extendParams:
    'settings' in item && item.settings && typeof item.settings === 'object'
      ? ((item.settings as { extendParams?: string[] }).extendParams ?? undefined)
      : undefined,
  id: item.id,
  knowledgeCutoff: item.knowledgeCutoff,
  providerId: item.providerId,
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
    // The user's own AI model row: custom/remote models miss both bundled
    // cards entirely, and builtin models may carry user-edited settings.
    getUserModelRow: async (model, provider) => {
      const row = await aiModelModel.findByIdAndProvider(model, provider);
      if (!row) return null;
      return {
        abilities: row.abilities,
        displayName: row.displayName,
        extendParams: row.settings?.extendParams ?? undefined,
      };
    },
  };
};
