import type { TaskOriginContext } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ChatGroupModel } from '@/database/models/chatGroup';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';

/**
 * Caller-supplied `context.origin`: the conversation a finished task reports
 * back to. `TaskResultBridgeService` inserts a `taskCallback` card into
 * `topicId` and wakes `agentId` there, so both are required together.
 */
export const taskOriginInputSchema = z.object({
  agentId: z.string().trim().min(1),
  messageId: z.string().trim().min(1).optional(),
  operationId: z.string().trim().min(1).optional(),
  toolCallId: z.string().trim().min(1).optional(),
  topicId: z.string().trim().min(1),
});

interface OriginAccessCtx {
  userId: string;
  workspaceId?: string;
}

// One message for every "not yours" case, so a caller cannot use the error to
// probe whether someone else's topic, agent or message exists.
const originNotFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Origin conversation not found' });

/**
 * Reject an origin the caller does not own. The bridge later writes into the
 * origin topic and runs the origin agent, so a forged pointer would plant a
 * callback card in a teammate's conversation and wake their agent.
 *
 * - the topic must be the caller's own conversation (in a workspace,
 *   `TopicModel` scope matches every member's topics, so pin `userId`);
 * - the agent must be usable by the caller and must be the topic's agent —
 *   or, for a group topic, a member of that group;
 * - an optional `messageId` must be a message in that topic.
 */
export async function assertTaskOriginAccessible(
  db: LobeChatDatabase,
  ctx: OriginAccessCtx,
  origin: TaskOriginContext,
): Promise<void> {
  const { agentId, messageId, topicId } = origin;
  if (!agentId || !topicId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Origin requires both agentId and topicId',
    });
  }

  const topic = await new TopicModel(db, ctx.userId, ctx.workspaceId).findById(topicId);
  if (!topic || topic.userId !== ctx.userId) throw originNotFound();

  try {
    await assertAgentUsableBy(db, agentId, ctx);
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') throw originNotFound();
    throw error;
  }

  if (topic.agentId !== agentId) {
    const inGroup =
      !!topic.groupId &&
      (
        await new ChatGroupModel(db, ctx.userId, ctx.workspaceId).getGroupAgents(topic.groupId)
      ).some((member) => member.agentId === agentId);
    if (!inGroup) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Origin agent does not belong to the origin topic',
      });
    }
  }

  if (messageId) {
    const message = await new MessageModel(db, ctx.userId, ctx.workspaceId).findById(messageId);
    if (!message || message.topicId !== topicId) throw originNotFound();
  }
}

const sameOrigin = (a?: TaskOriginContext, b?: TaskOriginContext) =>
  (a?.agentId ?? null) === (b?.agentId ?? null) &&
  (a?.topicId ?? null) === (b?.topicId ?? null) &&
  (a?.messageId ?? null) === (b?.messageId ?? null);

// What `TaskResultBridgeService` treats as a delivery target: it delivers
// whenever both ids are truthy, so the check must cover exactly those origins.
const isDeliverable = (origin: unknown): boolean => {
  if (!origin || typeof origin !== 'object') return false;
  const { agentId, topicId } = origin as Record<string, unknown>;
  return !!agentId && !!topicId;
};

/**
 * `task.update` replaces the whole `context` column, and clients ship the
 * current context back unchanged. Origin stays optional there, as it was
 * before: no origin, or one the bridge cannot deliver to (missing agent or
 * topic), is stored as sent. Only a deliverable target that changed (agent,
 * topic or anchor message) is checked, so re-saving a tool-created origin
 * keeps working while pointing a task at someone else's topic does not.
 * Returns the origin to store: the normalized one when checked, otherwise the
 * one that was sent.
 */
export async function assertTaskOriginPatchAllowed(
  db: LobeChatDatabase,
  ctx: OriginAccessCtx,
  current: TaskOriginContext | undefined,
  next: unknown,
): Promise<unknown> {
  if (!isDeliverable(next)) return next;
  const parsed = taskOriginInputSchema.safeParse(next);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Invalid context.origin: agentId and topicId must be non-empty strings',
    });
  }
  if (!sameOrigin(current, parsed.data)) await assertTaskOriginAccessible(db, ctx, parsed.data);
  // Return the parsed (trimmed) origin so the row stores exactly what was checked.
  return parsed.data;
}
