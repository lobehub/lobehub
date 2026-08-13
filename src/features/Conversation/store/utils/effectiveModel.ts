import { isCollaborativeBuiltinAgentRow } from '@lobechat/builtin-agents';
import type {
  AgentItem,
  AgentModelOverride,
  ConversationContext,
  LobeAgentConfig,
} from '@lobechat/types';
import { resolveAgentModelConfig } from '@lobechat/types';

import { getAgentProjectionById } from '@/projection';
import { agentProjectionSelectors, useAgentData } from '@/store/agent/projection';
import { getChatTopicById, useChatTopicById } from '@/store/chat/slices/topic/projection';
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
  const topic = getChatTopicById(context.topicId ?? undefined);
  const modelAgentId = context.subAgentId ?? context.agentId;
  const agent = getAgentProjectionById(modelAgentId);
  const sharedConfig = agentProjectionSelectors.config(agent);
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
  const topic = useChatTopicById(context.topicId ?? undefined);
  const modelAgentId = context.subAgentId ?? context.agentId;
  const agent = useAgentData(modelAgentId);
  const sharedConfig = agentProjectionSelectors.config(agent);
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
