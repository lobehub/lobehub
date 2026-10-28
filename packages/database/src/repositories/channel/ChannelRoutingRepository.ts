import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import {
  agents,
  channelAudit,
  channelMembers,
  channelMessages,
  workspaceMembers,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { findThread } from './delivery';
import { resolveRouting } from './routing';
import { audit, withChannelLock } from './transaction';

export const CHANNEL_ROUTING_LEASE_MS = 60_000;
export const CHANNEL_ROUTING_BATCH_SIZE = 10;

/**
 * System-only routing input. The existing indexed audit receipt leases an attempt without
 * holding a transaction over model IO. A recovered lease bumps the fencing token.
 */
export class ChannelRoutingRepository {
  constructor(private readonly db: LobeChatDatabase) {}

  pending = (channelId: string) =>
    this.db
      .select({ id: channelMessages.id })
      .from(channelMessages)
      .where(
        and(eq(channelMessages.channelId, channelId), eq(channelMessages.routingStatus, 'pending')),
      )
      .orderBy(asc(channelMessages.sequence))
      .limit(CHANNEL_ROUTING_BATCH_SIZE);

  claim = (channelId: string, messageId: string) =>
    withChannelLock(this.db, channelId, async (tx, channel) => {
      const [message] = await tx
        .select()
        .from(channelMessages)
        .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, messageId)));
      if (
        !message ||
        message.routingStatus !== 'pending' ||
        channel.isDeleted ||
        channel.status === 'archived'
      )
        return null;

      const thread = await findThread(tx, channelId, message.threadId);
      if (thread?.status === 'archived') {
        await resolveRouting(tx, channelId, messageId, message.routingAttempt, {
          reason: 'The thread is archived',
          status: 'unassigned',
        });
        return null;
      }
      if (thread) {
        const [root] = await tx
          .select({ routingStatus: channelMessages.routingStatus })
          .from(channelMessages)
          .where(eq(channelMessages.id, thread.rootMessageId));
        // No lease/model call until the root has supplied the branch's responders.
        if (root.routingStatus === 'pending') return null;
        if (root.routingStatus === 'unassigned' && !thread.followerMemberIds.length) {
          await resolveRouting(tx, channelId, messageId, message.routingAttempt, {
            reason: 'The root message has no assigned responders',
            status: 'unassigned',
          });
          return null;
        }
      }

      const [last] = await tx
        .select()
        .from(channelAudit)
        .where(
          and(
            eq(channelAudit.channelId, channelId),
            eq(channelAudit.targetId, messageId),
            eq(channelAudit.event, 'routing_started'),
          ),
        )
        .orderBy(desc(channelAudit.createdAt))
        .limit(1);
      const sameAttempt = last?.details.attempt === message.routingAttempt;
      if (sameAttempt && Date.now() - last.createdAt.getTime() < CHANNEL_ROUTING_LEASE_MS)
        return null;

      const attempt = message.routingAttempt + (sameAttempt ? 1 : 0);
      if (attempt !== message.routingAttempt)
        await tx
          .update(channelMessages)
          .set({ routingAttempt: attempt })
          .where(eq(channelMessages.id, messageId));

      const [sender] = message.userId
        ? await tx
            .select({ id: channelMembers.id })
            .from(channelMembers)
            .where(
              and(
                eq(channelMembers.channelId, channelId),
                eq(channelMembers.userId, message.userId),
                eq(channelMembers.actorType, 'user'),
                eq(channelMembers.status, 'active'),
              ),
            )
        : [];
      const [workspaceMember] =
        channel.workspaceId && message.userId
          ? await tx
              .select({ userId: workspaceMembers.userId })
              .from(workspaceMembers)
              .where(
                and(
                  eq(workspaceMembers.workspaceId, channel.workspaceId),
                  eq(workspaceMembers.userId, message.userId),
                  isNull(workspaceMembers.deletedAt),
                ),
              )
          : [];
      if (!message.userId || !sender || (channel.workspaceId && !workspaceMember)) {
        await resolveRouting(tx, channelId, messageId, attempt, {
          reason: 'The message sender is no longer available',
          status: 'unassigned',
        });
        return null;
      }

      const candidateQuery = tx
        .select({
          agentId: agents.id,
          model: agents.model,
          provider: agents.provider,
          description: channelMembers.description,
          agentDescription: agents.description,
          memberId: channelMembers.id,
          name: channelMembers.name,
        })
        .from(channelMembers)
        .innerJoin(agents, eq(agents.id, channelMembers.agentId))
        .where(
          and(
            eq(channelMembers.channelId, channelId),
            eq(channelMembers.actorType, 'agent'),
            eq(channelMembers.status, 'active'),
            thread ? inArray(channelMembers.id, thread.followerMemberIds) : undefined,
            buildWorkspaceWhere(
              { userId: message.userId, workspaceId: channel.workspaceId ?? undefined },
              agents,
            ),
          ),
        )
        .orderBy(asc(channelMembers.createdAt));
      // The model's candidate cap must not truncate deterministic fallback delivery.
      const candidates = await (message.routingSource === 'fallback'
        ? candidateQuery
        : candidateQuery.limit(21));

      // Main-channel history never contains sibling Threads. A Thread sees its root prefix
      // and its own branch, never later main-channel messages or future messages.
      const history = await tx
        .select({
          author: sql<string>`coalesce(${channelMessages.agentId}, ${channelMessages.userId}, 'deleted')`,
          content: sql<string>`left(${channelMessages.content}, 1500)`,
        })
        .from(channelMessages)
        .where(
          and(
            eq(channelMessages.channelId, channelId),
            lt(channelMessages.sequence, message.sequence),
            thread
              ? or(
                  eq(channelMessages.threadId, thread.id),
                  and(
                    isNull(channelMessages.threadId),
                    lte(channelMessages.sequence, thread.rootSequence),
                  ),
                )
              : isNull(channelMessages.threadId),
          ),
        )
        .orderBy(desc(channelMessages.sequence))
        .limit(20);

      await audit(tx, channelId, 'routing_started', messageId, { attempt });
      return {
        attempt,
        fallback: message.routingSource === 'fallback',
        candidates: candidates.map((member) => ({
          agentId: member.agentId,
          model: member.model,
          provider: member.provider,
          description: member.description || member.agentDescription || '',
          memberId: member.memberId,
          name: member.name || 'Agent',
        })),
        history: history.reverse(),
        message: message.content,
        messageId,
        userId: message.userId,
        workspaceId: channel.workspaceId,
      };
    });
}
