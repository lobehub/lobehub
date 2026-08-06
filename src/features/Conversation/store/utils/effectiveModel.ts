import { isCollaborativeBuiltinAgentRow } from '@lobechat/builtin-agents';
import type {
  AgentItem,
  AgentModelOverride,
  ConversationContext,
  LobeAgentConfig,
} from '@lobechat/types';
import { resolveAgentModelConfig } from '@lobechat/types';

import { getAgentStoreState, useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useUserStore } from '@/store/user';
import { userProfileSelectors, workspaceUserSettingsSelectors } from '@/store/user/selectors';
import type { ChatTopic } from '@/types/topic';

export interface EffectiveConversationModelConfig {
  model?: string;
  provider?: string;
}

type EffectiveConversationModelContext = Pick<
  ConversationContext,
  'agentId' | 'groupId' | 'scope' | 'subAgentId' | 'topicId'
>;

interface EffectiveConversationModelSources {
  agent?: Pick<Partial<AgentItem>, 'slug' | 'userId' | 'virtual' | 'visibility' | 'workspaceId'>;
  currentUserId?: string;
  memberOverride?: AgentModelOverride;
  sharedConfig?: LobeAgentConfig;
  topic?: Pick<ChatTopic, 'model' | 'provider'>;
}

const getConversationTopic = (
  context: EffectiveConversationModelContext,
  topicDataMap: ReturnType<typeof useChatStore.getState>['topicDataMap'],
) => {
  const topicListAgentId =
    context.groupId && context.scope === 'group' ? undefined : context.agentId;

  return context.topicId
    ? topicDataMap?.[
        topicMapKey({ agentId: topicListAgentId, groupId: context.groupId })
      ]?.items.find((item) => item.id === context.topicId)
    : undefined;
};

const resolveEffectiveConversationModelConfig = (
  modelAgentId: string | undefined,
  { agent, currentUserId, memberOverride, sharedConfig, topic }: EffectiveConversationModelSources,
): EffectiveConversationModelConfig => {
  if (topic?.model) return { model: topic.model, provider: topic.provider || undefined };
  if (!modelAgentId || !sharedConfig) return {};

  const isAuthor = !!currentUserId && agent?.userId === currentUserId;
  // Collaborative builtins have no author to speak of — the row belongs to
  // whoever opened the feature first — so their model stays personal for every
  // member (see `AgentModelConfig.personalModelSelection`).
  const personalModelSelection = isCollaborativeBuiltinAgentRow(agent ?? {});
  const usesWorkspaceMemberSelection =
    !!agent?.workspaceId && agent.visibility !== 'private' && (personalModelSelection || !isAuthor);
  const resolved = resolveAgentModelConfig(
    {
      ...sharedConfig,
      canManage: isAuthor,
      personalModelSelection,
      visibility: agent?.visibility,
      workspaceId: agent?.workspaceId,
    },
    usesWorkspaceMemberSelection ? memberOverride : undefined,
  );

  return {
    model: resolved.model,
    provider: resolved.provider ?? sharedConfig.provider,
  };
};

/**
 * Resolve the model a generation in this conversation would actually use.
 *
 * Resolution mirrors the generation chain (`streamingExecutor` +
 * `agentConfigResolver`):
 * 1. Topic-scoped override — a topic snapshots the model it was created with
 *    and remembers switches made while active (top-level `topics.model`,
 *    read via `getTopicModelById`).
 * 2. Member override — public workspace agents in member-selection mode read
 *    the per-user `workspaceUserPreference.agentModelOverrides` entry through
 *    `resolveAgentModelConfig`, leaving the shared default untouched.
 * 3. Shared agent default.
 *
 * UI guards keyed on model capabilities (e.g. the Claude prefill checks) must
 * resolve the same effective model, not the shared agent default.
 */
export const getEffectiveConversationModelConfig = (
  context: EffectiveConversationModelContext,
): EffectiveConversationModelConfig => {
  // Guard on topicDataMap: this runs inside UI actions whose tests build
  // partially-mocked chat stores, and a capability guard must never throw.
  const chatState = useChatStore.getState();
  const topic = getConversationTopic(context, chatState.topicDataMap);
  const modelAgentId = context.subAgentId ?? context.agentId;
  const agentState = getAgentStoreState();
  const sharedConfig = agentSelectors.getAgentConfigById(modelAgentId)(agentState);
  const agent = agentByIdSelectors.getAgentById(modelAgentId)(agentState);
  const userState = useUserStore.getState();
  const currentUserId = userProfileSelectors.userId(userState);
  const memberOverride =
    workspaceUserSettingsSelectors.agentModelOverrideById(modelAgentId)(userState);

  return resolveEffectiveConversationModelConfig(modelAgentId, {
    agent,
    currentUserId,
    memberOverride,
    sharedConfig,
    topic,
  });
};

/** Reactive counterpart used by capability-gated conversation controls. */
export const useEffectiveConversationModelConfig = (
  context: EffectiveConversationModelContext,
): EffectiveConversationModelConfig => {
  const topic = useChatStore((state) => getConversationTopic(context, state.topicDataMap));
  const modelAgentId = context.subAgentId ?? context.agentId;
  const [agent, sharedConfig] = useAgentStore((state) => [
    agentByIdSelectors.getAgentById(modelAgentId)(state),
    agentSelectors.getAgentConfigById(modelAgentId)(state),
  ]);
  const [currentUserId, memberOverride] = useUserStore((state) => [
    userProfileSelectors.userId(state),
    workspaceUserSettingsSelectors.agentModelOverrideById(modelAgentId)(state),
  ]);

  return resolveEffectiveConversationModelConfig(modelAgentId, {
    agent,
    currentUserId,
    memberOverride,
    sharedConfig,
    topic,
  });
};

export const getEffectiveConversationModel = (
  context: EffectiveConversationModelContext,
): string | undefined => getEffectiveConversationModelConfig(context).model;
