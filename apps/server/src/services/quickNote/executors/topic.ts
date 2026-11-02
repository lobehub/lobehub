import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { assertAgentUsableBy } from '@/database/utils/agent-access';

import { assertQuickNoteCreatePermission } from './permission';
import { quickNoteTopicPayloadSchema } from './schemas';
import type { QuickNoteProposalExecutor } from './types';
import { QuickNoteApplyError } from './types';

/**
 * `topic` Proposals: open a conversation whose first user message is the note.
 *
 * The conversation is created idle. The user opens it and the agent answers on the next turn,
 * so applying never calls a model. Requires `TOPIC_CREATE`, like starting a conversation directly.
 */
export const topicExecutor: QuickNoteProposalExecutor<'topic'> = {
  execute: async (ctx, payload) => {
    await assertQuickNoteCreatePermission(ctx, 'TOPIC_CREATE');

    let agentId = payload.agentId;
    if (agentId) {
      await assertAgentUsableBy(ctx.db, agentId, {
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    } else {
      const inbox = await new AgentModel(ctx.db, ctx.userId, ctx.workspaceId).getBuiltinAgent(
        BUILTIN_AGENT_SLUGS.inbox,
      );
      if (!inbox) throw new QuickNoteApplyError('not_found', 'Inbox agent is not available');
      agentId = inbox.id;
    }

    const topic = await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId).create({
      agentId,
      title: payload.title,
    });
    await new MessageModel(ctx.db, ctx.userId, ctx.workspaceId).create({
      agentId,
      content: payload.openingMessage,
      role: 'user',
      topicId: topic.id,
    });

    return { resultId: topic.id, resultType: 'topic' };
  },
  kind: 'topic',
  schema: quickNoteTopicPayloadSchema,
};
