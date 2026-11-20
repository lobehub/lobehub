import type { AgentSenderMetadata } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';

import { resolveAgentSenderFromOperation } from './sourceAttribution';

/**
 * Resolve the sending agent of an agent → agent send outside an
 * `AiAgentService` — for a follow-up queued behind a running turn, whose sender
 * has to be resolved while the sending run is still in flight to vouch for it.
 * Same trust and shareability rules as the service's own resolution.
 */
export const resolveAgentSender = (
  ctx: { db: LobeChatDatabase; userId: string; workspaceId?: null | string },
  params: { destinationAgentId: string; sourceOperationId?: string },
): Promise<AgentSenderMetadata | undefined> => {
  const workspaceId = ctx.workspaceId ?? undefined;
  const agentModel = new AgentModel(ctx.db, ctx.userId, workspaceId);

  return resolveAgentSenderFromOperation(params.sourceOperationId, {
    destinationAgentId: params.destinationAgentId,
    findAgentDisplayFields: (agentId) => agentModel.getAgentDisplayFields(agentId),
    findAgentVisibility: (agentId) => agentModel.getAgentVisibility(agentId),
    findChatGroupVisibility: async (chatGroupId) =>
      (await new ChatGroupModel(ctx.db, ctx.userId, workspaceId).findById(chatGroupId))
        ?.visibility ?? null,
    findOperation: (operationId) =>
      new AgentOperationModel(ctx.db, ctx.userId, workspaceId).findById(operationId),
    findTopic: (topicId) => new TopicModel(ctx.db, ctx.userId, workspaceId).findById(topicId),
    findTriggerHop: (hopParams) =>
      new MessageModel(ctx.db, ctx.userId, workspaceId).findLatestUserTurnHop(hopParams),
    userId: ctx.userId,
    workspaceId,
  });
};
