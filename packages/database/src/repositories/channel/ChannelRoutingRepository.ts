import {
  agentDisplayName,
  CHANNEL_DELETED_AGENT_NAME,
  CHANNEL_DELETED_USER_NAME,
} from '@lobechat/types';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, lte, or } from 'drizzle-orm';

import {
  agents,
  channelAudit,
  channelJobs,
  channelMembers,
  channelMessages,
  users,
  workspaceMembers,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { fileIdsByMessage } from './attachments';
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
          agentTitle: agents.title,
          model: agents.model,
          ownerId: agents.userId,
          provider: agents.provider,
          description: channelMembers.description,
          agentDescription: agents.description,
          config: channelMembers.config,
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
      const branch = thread
        ? or(
            eq(channelMessages.threadId, thread.id),
            and(
              isNull(channelMessages.threadId),
              lte(channelMessages.sequence, thread.rootSequence),
            ),
          )
        : isNull(channelMessages.threadId);
      const history = await tx
        .select({
          agentId: channelMessages.agentId,
          agentName: agents.name,
          agentTitle: agents.title,
          content: channelMessages.content,
          createdAt: channelMessages.createdAt,
          fullName: users.fullName,
          id: channelMessages.id,
          routingStatus: channelMessages.routingStatus,
          userId: channelMessages.userId,
          username: users.username,
        })
        .from(channelMessages)
        .leftJoin(users, eq(users.id, channelMessages.userId))
        .leftJoin(agents, eq(agents.id, channelMessages.agentId))
        .where(
          and(
            eq(channelMessages.channelId, channelId),
            lt(channelMessages.sequence, message.sequence),
            branch,
          ),
        )
        .orderBy(desc(channelMessages.sequence))
        .limit(20);
      const [author] = await tx
        .select({ fullName: users.fullName, username: users.username })
        .from(users)
        .where(eq(users.id, message.userId));
      const attachments = await fileIdsByMessage(tx, [messageId]);

      // What each candidate's own wake rules read: when it last answered here, whom, and how
      // often it has stayed silent since. Scoped like the history: the branch, then the request.
      // Fallback routing runs no rules. One transaction connection serializes the reads anyway,
      // so they run one candidate at a time (at most 21).
      const wakeState = new Map<
        string,
        { lastReplyAt?: number; lastReplyToUserId?: string; silentWakes: number }
      >();
      for (const candidate of message.routingSource === 'fallback' ? [] : candidates) {
        const [lastReply] = await tx
          .select({
            at: channelMessages.createdAt,
            requesterUserId: channelMembers.userId,
          })
          .from(channelMessages)
          .leftJoin(channelJobs, eq(channelJobs.publishedMessageId, channelMessages.id))
          .leftJoin(channelMembers, eq(channelMembers.id, channelJobs.requesterMemberId))
          .where(
            and(
              eq(channelMessages.channelId, channelId),
              eq(channelMessages.agentId, candidate.agentId),
              eq(channelMessages.routingStatus, 'reply'),
              lt(channelMessages.sequence, message.sequence),
              branch,
            ),
          )
          .orderBy(desc(channelMessages.sequence))
          .limit(1);
        const [silent] = await tx
          .select({ value: count() })
          .from(channelJobs)
          .where(
            and(
              eq(channelJobs.channelId, channelId),
              eq(channelJobs.memberId, candidate.memberId),
              eq(channelJobs.status, 'silent'),
              message.threadId
                ? eq(channelJobs.threadId, message.threadId)
                : isNull(channelJobs.threadId),
              // Settled, not enqueued: a job queued while this member was still answering can
              // settle as silent after that reply is published, and it still spent the budget.
              lastReply ? gt(channelJobs.updatedAt, lastReply.at) : undefined,
            ),
          );
        wakeState.set(candidate.memberId, {
          lastReplyAt: lastReply?.at.getTime(),
          lastReplyToUserId: lastReply?.requesterUserId ?? undefined,
          silentWakes: silent?.value ?? 0,
        });
      }

      await audit(tx, channelId, 'routing_started', messageId, { attempt });
      return {
        attempt,
        author: {
          id: message.userId,
          name: author?.fullName || author?.username || CHANNEL_DELETED_USER_NAME,
        },
        fallback: message.routingSource === 'fallback',
        candidates: candidates.map((member) => ({
          agentId: member.agentId,
          model: member.model,
          provider: member.provider,
          description: member.description || member.agentDescription || '',
          memberId: member.memberId,
          name: member.name || 'Agent',
          ownerId: member.ownerId,
          title: member.agentTitle ?? undefined,
          wake: member.config?.wake,
          silentWakes: 0,
          ...wakeState.get(member.memberId),
        })),
        channelWake: channel.config?.wake,
        hasAttachments: attachments.has(messageId),
        history: history.reverse().map((line) => {
          const isAgent = line.routingStatus === 'reply';
          return {
            at: line.createdAt.getTime(),
            author: isAgent
              ? line.agentId
                ? agentDisplayName({ name: line.agentName, title: line.agentTitle }, 'Agent')
                : CHANNEL_DELETED_AGENT_NAME
              : line.fullName || line.username || CHANNEL_DELETED_USER_NAME,
            authorId: (isAgent ? line.agentId : line.userId) ?? undefined,
            content: line.content.slice(0, 1500),
            id: line.id,
            isAgent,
          };
        }),
        message: message.content,
        messageId,
        threadId: message.threadId,
        userId: message.userId,
        workspaceId: channel.workspaceId,
      };
    });
}
