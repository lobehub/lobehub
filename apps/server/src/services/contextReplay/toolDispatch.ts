import { builtinTools } from '@lobechat/builtin-tools';
import { assertToolDispatchPolicy } from '@lobechat/mecha';

import { AgentModel } from '@/database/models/agent';
import { getTopicDeviceId, TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { assertCanUseConversationTargets } from '@/server/routers/lambda/_helpers/conversationResourceGuard';

export const assertCurrentToolDispatch = async (input: {
  agentId: string;
  apiName: string;
  db: LobeChatDatabase;
  expectedDeviceId?: string;
  identifier: string;
  includeShareVisitor?: boolean;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}) => {
  await assertCanUseConversationTargets(input, [{ agentId: input.agentId }]);
  const [policy, topic] = await Promise.all([
    new AgentModel(input.db, input.userId, input.workspaceId).getAgentToolPolicy(input.agentId),
    input.topicId
      ? new TopicModel(input.db, input.userId, input.workspaceId, undefined, {
          includeShareVisitor: input.includeShareVisitor,
        }).findById(input.topicId)
      : undefined,
  ]);
  if (!policy || (input.topicId && !topic)) throw new Error('Conversation is no longer available');
  assertToolDispatchPolicy({
    ...input,
    chatConfig: policy.chatConfig,
    executionTarget: policy.agencyConfig?.executionTarget,
    plugins: policy.plugins ?? undefined,
    conversationMode: topic?.metadata?.conversationMode,
    currentDeviceId: getTopicDeviceId(topic?.metadata),
    manifest: builtinTools.find((tool) => tool.identifier === input.identifier)?.manifest,
  });
};
