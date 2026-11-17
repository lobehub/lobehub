import type { AgentState } from '@lobechat/agent-runtime';
import type { LobeChatDatabase } from '@lobechat/database';
import { buildChannelPrompt } from '@lobechat/prompts';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { ChannelExecutionRepository } from '@/database/repositories/channel';
import { getServerDefaultAgentConfig } from '@/server/globalConfig';
import { createUserTurnAnchor } from '@/server/services/aiAgent/pipeline/resolveUserMessageParentId';
import { buildUserTurnMetadata } from '@/server/services/aiAgent/pipeline/userTurnMetadata';

import { notifyChannel } from './notify';

const log = debug('lobe-server:channel-steer');

/**
 * A running Channel run is at a decision point right before its next LLM call: take the requests
 * queued behind it in its branch into the run as one steer user message, so its one reply answers
 * them too (see `ChannelExecutionRepository.steer`). Only a top-level Native run is steered; an
 * external CLI run, or a request it cannot read as text, waits and joins the next claim instead.
 *
 * @returns the persisted user message, or `undefined` when nothing joined
 */
export const injectChannelSteer = async (
  ctx: { db: LobeChatDatabase; userId: string; workspaceId?: string | null },
  { operationId, state }: { operationId: string; state: AgentState },
): Promise<{ messageId: string } | undefined> => {
  const origin = state.origin;
  if (origin?.trigger !== 'channel' || !origin.topicId) return;
  if (origin.lineage?.isSubAgent || origin.lineage?.parentOperationId) return;
  const topicId = origin.topicId;

  const joined = await new ChannelExecutionRepository(ctx.db).steer(operationId, {
    join: async ({ channelId, context, manifest, omitted, requests }) => {
      const messageModel = new MessageModel(ctx.db, ctx.userId, ctx.workspaceId ?? undefined);
      const parentId = await createUserTurnAnchor(messageModel, {
        allowShareVisitor: false,
        threadId: origin.threadId ?? null,
        topicId,
      }).resolveParentId();
      const message = await messageModel.create({
        agentId: origin.agentId,
        content: buildChannelPrompt(
          {
            requestMessageId: requests[0].id,
            requestMessageIds: requests.map(({ id }) => id),
            self: manifest.self,
          },
          requests,
          { context, omitted, steer: true },
        ),
        metadata: buildUserTurnMetadata({ steer: true }),
        parentId,
        role: 'user',
        threadId: origin.threadId ?? undefined,
        topicId,
      });
      return { channelId, count: requests.length, messageId: message.id };
    },
    serverDefaultAgentConfig: getServerDefaultAgentConfig(),
  });
  if (!joined) return;

  log('[%s] Joined %d queued Channel requests as %s', operationId, joined.count, joined.messageId);
  await notifyChannel(ctx.db, joined.channelId).catch((error) =>
    console.error('[channel:steer:notify]', error),
  );
  return { messageId: joined.messageId };
};
