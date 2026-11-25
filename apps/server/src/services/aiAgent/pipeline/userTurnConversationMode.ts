import type { LobeAgentChatConfig } from '@lobechat/types';
import { resolveToolMode } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import type { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';

export const userTurnConversationMode = async (input: {
  chatConfig?: LobeAgentChatConfig;
  db: LobeChatDatabase;
  threadId?: string | null;
  topicId: string;
  topicModel: Pick<TopicModel, 'findById' | 'resolveConversationMode'>;
  userId: string;
  workspaceId?: string;
}) => {
  const fallback =
    resolveToolMode(input.chatConfig) === 'chat' ? ('chat' as const) : ('agent' as const);
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
    resolveToolMode(host ? host.chatConfig : undefined) === 'chat' ? 'chat' : 'agent',
  );
};
