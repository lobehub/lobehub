import { resolveAgentModelConfig } from '@lobechat/types';

import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

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
export const getEffectiveConversationModel = (context: {
  agentId?: string | null;
  topicId?: string | null;
}): string | undefined => {
  // Guard on topicDataMap: this runs inside UI actions whose tests build
  // partially-mocked chat stores, and a capability guard must never throw.
  const chatState = useChatStore.getState();
  const topicModel =
    context.topicId && chatState.topicDataMap
      ? topicSelectors.getTopicModelById(context.topicId)(chatState)?.model
      : undefined;
  if (topicModel) return topicModel;

  if (!context.agentId) return undefined;

  const agentState = getAgentStoreState();
  const sharedConfig = agentSelectors.getAgentConfigById(context.agentId)(agentState);
  const agent = agentByIdSelectors.getAgentById(context.agentId)(agentState);
  const userState = useUserStore.getState();
  const currentUserId = userProfileSelectors.userId(userState);
  const isAuthor = !!currentUserId && agent?.userId === currentUserId;
  const usesWorkspaceMemberSelection =
    !!agent?.workspaceId && agent.visibility !== 'private' && !isAuthor;
  const memberOverride = usesWorkspaceMemberSelection
    ? userState.workspaceUserPreference?.agentModelOverrides?.[context.agentId]
    : undefined;

  return resolveAgentModelConfig(
    {
      ...sharedConfig,
      canManage: isAuthor,
      visibility: agent?.visibility,
      workspaceId: agent?.workspaceId,
    },
    memberOverride,
  ).model;
};
