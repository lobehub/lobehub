import type { UIChatMessage } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { AcceptanceCommentModel } from '@/database/models/acceptanceComment';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { users } from '@/database/schemas';
import { acceptances } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { isUuid } from '@/database/utils/uuid';
import { router } from '@/libs/trpc/lambda';
import { FileService } from '@/server/services/file';
import { AcceptanceService } from '@/server/services/verify';

import { agentNotifyRouter } from '../agentNotify';
import { acceptanceProcedure, canReadAcceptance } from './procedures';

/** One message to the bound agent; long enough for a detailed brief, not a dump. */
const COLLABORATOR_MESSAGE_MAX_LENGTH = 4000;

/**
 * The owner's conversation an edit-collaborator may talk in.
 *
 * Edit-collaboration is granted per acceptance by one of its deciders, and it
 * reaches into the OWNER's conversation: the topic the delivery was produced
 * in, and the agent that produced it. Everything here therefore reads and
 * writes as the owner, the way a granted reject dispatches its repair — the
 * collaborator could reach neither on their own, and that reach is exactly
 * what was granted. The owner holds this conversation already and uses their
 * own chat, so this path is for grantees only.
 */
const resolveCollaboration = async (
  ctx: { serverDB: LobeChatDatabase; userId: string },
  id: string,
) => {
  const acceptance = isUuid(id)
    ? await ctx.serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, id) })
    : undefined;
  if (!acceptance || !(await canReadAcceptance(ctx, acceptance)))
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });

  const granted =
    ctx.userId !== acceptance.userId &&
    (await new AcceptanceCommentModel(ctx.serverDB).hasAccessGrant(
      acceptance.id,
      ctx.userId,
      'collaborate',
    ));
  if (!granted)
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Edit-collaboration access to this acceptance is required',
    });

  const workspaceId = acceptance.workspaceId ?? undefined;
  const origin = await new AcceptanceService(
    ctx.serverDB,
    acceptance.userId,
    workspaceId,
  ).findRepairOrigin(acceptance.id);
  const topic = origin?.topicId
    ? await new TopicModel(ctx.serverDB, acceptance.userId, workspaceId).findOwnTopicById(
        origin.topicId,
      )
    : undefined;
  const agentId = origin?.agentId ?? topic?.agentId ?? undefined;
  if (!topic || !agentId)
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'This acceptance has no conversation bound to it',
    });

  return { acceptance, agentId, topicId: topic.id, workspaceId };
};

const isAgentRunning = async (
  db: LobeChatDatabase,
  owner: { userId: string; workspaceId?: string },
  topicId: string,
) =>
  (await new AgentOperationModel(db, owner.userId, owner.workspaceId).findLiveByTopic(topicId))
    .length > 0;

/**
 * Who said it, on the line the agent and the owner read. The message is stored
 * under the owner's account (it is the owner's conversation), so without this
 * nothing would tell either of them it came from someone else.
 */
export const formatCollaboratorMessage = (name: string, content: string) =>
  `**${name}** (acceptance collaborator):\n\n${content}`;

export const collaborationRouter = router({
  /**
   * The bound conversation as a collaborator sees it: the transcript, read as
   * the owner but through the visitor projection, which drops the owner's
   * account identity, model/spend snapshot and raw error payloads — none of
   * which the grant hands out. `running` says whether the agent is mid-reply,
   * so the page polls only while it is. `agentId` is the one every assistant
   * row already carries, returned so the page can put a face and name on them.
   */
  getOriginConversation: acceptanceProcedure
    .input(z.object({ id: z.string() }))
    .query(
      async ({
        ctx,
        input,
      }): Promise<{ agentId: string; messages: UIChatMessage[]; running: boolean }> => {
        const { acceptance, agentId, topicId, workspaceId } = await resolveCollaboration(
          ctx,
          input.id,
        );
        const fileService = new FileService(ctx.serverDB, acceptance.userId, workspaceId);
        const [messages, running] = await Promise.all([
          new MessageModel(ctx.serverDB, acceptance.userId, workspaceId).queryForVisitor(
            { topicId },
            {
              postProcessUrl: (path, file) =>
                fileService.getFileAccessUrl({ id: file.id, url: path }),
            },
          ),
          isAgentRunning(ctx.serverDB, { userId: acceptance.userId, workspaceId }, topicId),
        ]);
        return { agentId, messages, running };
      },
    ),

  /**
   * Talk to the bound agent: the message lands in the owner's conversation and
   * the owner's agent replies, exactly as if the owner had sent it — through
   * `agentNotify.notify` itself, so it carries that path's conversation-write
   * and agent-use gates for the owner. One turn at a time: a message sent while
   * the agent is still replying is refused rather than started beside it.
   */
  sendToOriginAgent: acceptanceProcedure
    .input(
      z.object({
        content: z.string().trim().min(1).max(COLLABORATOR_MESSAGE_MAX_LENGTH),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { acceptance, agentId, topicId, workspaceId } = await resolveCollaboration(
        ctx,
        input.id,
      );
      if (await isAgentRunning(ctx.serverDB, { userId: acceptance.userId, workspaceId }, topicId))
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The agent is still replying — send again once it is done',
        });

      const [sender] = await ctx.serverDB
        .select({ fullName: users.fullName, username: users.username })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1);
      const name = sender?.fullName || sender?.username || 'A collaborator';

      const { operationId } = await agentNotifyRouter
        .createCaller({ ...ctx, userId: acceptance.userId, workspaceId: acceptance.workspaceId })
        .notify({
          agentId,
          content: formatCollaboratorMessage(name, input.content),
          role: 'user',
          topicId,
        });
      return { operationId: operationId ?? null };
    }),
});
