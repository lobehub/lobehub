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
export interface BrowserModelParamsSource {
  /** The group the run belongs to; a topic listed under a group is a group topic. */
  groupId?: string;
}

interface StoredTopicOwnership {
  agentId?: string | null;
  groupId?: string | null;
}

export const createBrowserModelParamsProviders = ({
  groupId,
}: BrowserModelParamsSource = {}): ModelParamsProviders => ({
  findTopicReasoningPin: async (topicId) => {
    const chatState = getChatStoreState();
    const topic = topicSelectors.getTopicById(topicId)(chatState);
    if (!topic?.model) return null;
    // The group sidebar's slim list projection carries neither `agentId` nor
    // `groupId`; the detail cache (a full row) does. Prefer it, then whatever
    // the list row kept, and finally the run's own group — a group topic
    // whose owning agent is unknown must not pass as a personal one, or the
    // pin would apply to every member that answers.
    const listed = topic as typeof topic & StoredTopicOwnership;
    const detail = chatState.topicDetailMap?.[topicId] as
      (typeof topic & StoredTopicOwnership) | undefined;
    return {
      agentId: detail?.agentId ?? listed.agentId,
      groupId: detail?.groupId ?? listed.groupId ?? groupId,
      model: topic.model,
      provider: topic.provider || '',
      reasoningConfig: topic.metadata?.reasoningConfig,
    };
  },
  getModelReasoningConfig: async (model, provider) =>
    aiModelSelectors.modelReasoningConfig(model, provider)(getAiInfraStoreState()),
  // The enabled list already merges the user's settings over the card, so it
  // doubles as the user row: an explicitly emptied extend-param list is an
  // opt-out the shared rule must keep, not a miss to fall back from.
  getUserModelRow: async (m, p) => {
    const state = getAiInfraStoreState();
    const own = aiModelSelectors.getEnabledModelById(m, p)(state);
    const extendParams = aiModelSelectors.modelExtendParams(m, p)(state);
    if (!own && extendParams === undefined) return null;
    return { displayName: own?.displayName, extendParams };
  },
  listModelCards: () => {
    const state = getAiInfraStoreState();
    return [...(state.enabledAiModels ?? []), ...state.builtinAiModelList].map(toModelCard);
  },
});

export interface BrowserModelParamsContext {
  /** The answering agent; a group topic's pin only counts for it. */
  agentId?: string;
  chatConfig: LobeAgentChatConfig;
  /** The group the run belongs to, when any. */
  groupId?: string;
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
    createBrowserModelParamsProviders({ groupId: ctx.groupId }),
  );
