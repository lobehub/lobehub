import type { ConversationMode, LobeAgentChatConfig } from '@lobechat/types';
import { resolveToolMode } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import type { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';

export const preferredConversationMode = ({
  canManage = true,
  chatConfig,
  memberMode,
}: {
  canManage?: boolean;
  chatConfig?: LobeAgentChatConfig | null;
  memberMode?: boolean;
}): ConversationMode => {
  if (!canManage && memberMode !== undefined) return memberMode ? 'agent' : 'chat';
  return resolveToolMode(chatConfig) === 'chat' ? 'chat' : 'agent';
};

export const userTurnConversationMode = async (input: {
  chatConfig?: LobeAgentChatConfig;
  db: LobeChatDatabase;
  threadId?: string | null;
  topicId: string;
  topicModel: Pick<TopicModel, 'findById' | 'resolveConversationMode'>;
  userId: string;
  workspaceId?: string;
}) => {
  const fallback = preferredConversationMode({ chatConfig: input.chatConfig });
  if (!input.threadId) return fallback;
  const topic = await input.topicModel.findById(input.topicId);
  if (!topic) throw new Error('Host topic is unavailable');
  if (topic.metadata?.conversationMode) return topic.metadata.conversationMode;
  const host =
    topic.agentId &&
    (await new AgentModel(input.db, input.userId, input.workspaceId).getAgentToolPolicy(
      topic.agentId,
    ));
  return input.topicModel.resolveConversationMode(
    input.topicId,
    preferredConversationMode({ chatConfig: host ? host.chatConfig : undefined }),
  );
};
