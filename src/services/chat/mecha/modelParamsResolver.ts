import {
  type ModelParamsProviders,
  type ModelParamsRequest,
  type ResolvedModelParams,
  resolveModelParams,
} from '@lobechat/mecha';
import {
  type ModelExtendParams,
  resolveDefaultEnableAdaptiveThinkingForModel,
  resolveDefaultThinkingLevelForModel,
} from '@lobechat/model-runtime/utils/modelExtendParams';
import type { LobeAgentChatConfig } from '@lobechat/types';
import type { EnabledAiModel, LobeDefaultAiModelListItem } from 'model-bank';

import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { getChatStoreState } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

export type { ModelExtendParams };
export { resolveDefaultEnableAdaptiveThinkingForModel, resolveDefaultThinkingLevelForModel };

const toModelCard = (item: EnabledAiModel | LobeDefaultAiModelListItem) => ({
  abilities: item.abilities,
  deploymentName: item.config?.deploymentName,
  displayName: item.displayName,
  extendParams: item.settings?.extendParams,
  id: item.id,
  knowledgeCutoff: item.knowledgeCutoff,
  providerId: item.providerId,
});

/**
 * How the browser answers the model-parameter rules: the enabled model list
 * (which already merges the user's own settings over the bundled card, so no
 * separate user row exists here), the bundled bank as a fallback, the cached
 * model-instance reasoning config and the topic's reasoning pin — all read
 * from the stores, never the network.
 */
export const createBrowserModelParamsProviders = ({
  model,
  provider,
}: {
  model: string;
  provider: string;
}): ModelParamsProviders => ({
  findTopicReasoningPin: async (topicId) => {
    const topic = topicSelectors.getTopicById(topicId)(getChatStoreState());
    if (!topic?.model) return null;
    // The store keeps the row's ownership columns beyond the `ChatTopic` type.
    const stored = topic as typeof topic & { agentId?: string | null; groupId?: string | null };
    return {
      agentId: stored.agentId,
      groupId: stored.groupId,
      model: topic.model,
      provider: topic.provider || '',
      reasoningConfig: topic.metadata?.reasoningConfig,
    };
  },
  getModelReasoningConfig: async (model, provider) =>
    aiModelSelectors.modelReasoningConfig(model, provider)(getAiInfraStoreState()),
  listModelCards: () => {
    const state = getAiInfraStoreState();
    // The attempt's own card goes through the selectors so a user-edited
    // extend-param list is honoured exactly as the rest of the app reads it.
    const own = aiModelSelectors.getEnabledModelById(model, provider)(state);
    const ownExtendParams = aiModelSelectors.modelExtendParams(model, provider)(state);
    const ownCard =
      own || ownExtendParams
        ? [
            {
              ...(own ? toModelCard(own) : { id: model, providerId: provider }),
              extendParams: ownExtendParams,
            },
          ]
        : [];
    return [
      ...ownCard,
      ...(state.enabledAiModels ?? []).filter((item) => item !== own),
      ...state.builtinAiModelList,
    ].map((item) => ('providerId' in item && 'extendParams' in item ? item : toModelCard(item)));
  },
});

export interface BrowserModelParamsContext {
  /** The answering agent; a group topic's pin only counts for it. */
  agentId?: string;
  chatConfig: LobeAgentChatConfig;
  model: string;
  provider: string;
  searchDecision?: ModelParamsRequest['searchDecision'];
  /** Raw sub-agent chatConfig override; explicit reasoning fields here win. */
  subAgentChatConfigOverride?: Partial<LobeAgentChatConfig>;
  topicId?: string;
}

/**
 * The model parameters of one browser-side LLM call, decided by the shared
 * rules in `@lobechat/mecha` (the same ones the server runtime applies) over
 * the browser's stores.
 */
export const resolveBrowserModelParams = (
  ctx: BrowserModelParamsContext,
): Promise<ResolvedModelParams> =>
  resolveModelParams(
    {
      agent: {
        chatConfig: ctx.chatConfig,
        id: ctx.agentId,
        subAgentChatConfigOverride: ctx.subAgentChatConfigOverride,
      },
      model: ctx.model,
      provider: ctx.provider,
      searchDecision: ctx.searchDecision,
      topicId: ctx.topicId,
    },
    createBrowserModelParamsProviders({ model: ctx.model, provider: ctx.provider }),
  );
