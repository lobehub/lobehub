import { and, asc, desc, eq, getTableColumns, inArray, isNull, lt, sql } from 'drizzle-orm';

import {
  agentOperations,
  agents,
  channelJobs,
  channelMembers,
  channelMessages,
  channelThreads,
  files as fileTable,
  users,
} from '../../schemas';
import type { Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { fileIdsByMessage } from './attachments';
import { activeMembers } from './delivery';
import { ChannelError } from './error';

const publicMessageColumns = {
  ...getTableColumns(channelMessages),
  senderAgentAvatar: agents.avatar,
  senderAgentName: agents.name,
  senderAgentTitle: agents.title,
  senderUserAvatar: users.avatar,
  senderUserName: users.fullName,
  senderUsername: users.username,
};

type MessageRow = typeof channelMessages.$inferSelect & {
  senderAgentAvatar: string | null;
  senderAgentName: string | null;
  senderAgentTitle: string | null;
  senderUserAvatar: string | null;
  senderUserName: string | null;
  senderUsername: string | null;
};

const publicMessage = (row: MessageRow, fileIds: string[]) => {
  const {
    senderAgentAvatar,
    senderAgentName,
    senderAgentTitle,
    senderUserAvatar,
    senderUserName,
    senderUsername,
    ...message
  } = row;
  const isAgent = message.routingStatus === 'reply';
  return {
    ...message,
    fileIds,
    author: {
      avatar: isAgent ? senderAgentAvatar : senderUserAvatar,
      id: isAgent ? message.agentId : message.userId,
      name: isAgent ? senderAgentName || senderAgentTitle : senderUserName || senderUsername,
      type: isAgent ? ('agent' as const) : ('user' as const),
    },
  };
};

/** Public projection only. Execution settings, drafts and internal messages never leave this boundary. */
export const readChannelView = async (
  tx: Transaction,
  channelId: string,
  options: { before?: number; limit?: number; threadId?: string | null } = {},
) => {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 100));
  const [members, reversed, threads, jobs] = await Promise.all([
    tx
      .select({
        actorType: channelMembers.actorType,
        agentId: channelMembers.agentId,
        avatar: agents.avatar,
        description: channelMembers.description,
        id: channelMembers.id,
        name: channelMembers.name,
        role: channelMembers.role,
        status: channelMembers.status,
        userId: channelMembers.userId,
        userName: users.fullName,
        username: users.username,
        userAvatar: users.avatar,
        lastReadSequence: channelMembers.lastReadSequence,
        joinedAt: channelMembers.createdAt,
      })
      .from(channelMembers)
      .leftJoin(users, eq(users.id, channelMembers.userId))
      .leftJoin(agents, eq(agents.id, channelMembers.agentId))
      .where(eq(channelMembers.channelId, channelId))
      .orderBy(asc(channelMembers.createdAt)),
    tx
      .select(publicMessageColumns)
      .from(channelMessages)
      .leftJoin(users, eq(users.id, channelMessages.userId))
      .leftJoin(agents, eq(agents.id, channelMessages.agentId))
      .where(
        and(
          eq(channelMessages.channelId, channelId),
          options.threadId
            ? eq(channelMessages.threadId, options.threadId)
            : isNull(channelMessages.threadId),
          options.before === undefined ? undefined : lt(channelMessages.sequence, options.before),
        ),
      )
      .orderBy(desc(channelMessages.sequence))
      .limit(limit + 1),
    tx
      .select()
      .from(channelThreads)
      .where(and(eq(channelThreads.channelId, channelId), notTrashed(channelThreads.isDeleted)))
      .orderBy(asc(channelThreads.createdAt)),
    tx
      .select({
        id: channelJobs.id,
        memberId: channelJobs.memberId,
        messageId: channelJobs.messageId,
        requesterMemberId: channelJobs.requesterMemberId,
        threadId: channelJobs.threadId,
        status: channelJobs.status,
        blockedCode: channelJobs.blockedCode,
        // Only a bounded diagnostic message crosses the public boundary, never the raw error.
        errorMessage: sql<string | null>`CASE WHEN ${channelJobs.status} = 'failed'
          THEN left(${agentOperations.error}->>'message', 2000) ELSE NULL END`,
        writerHeld: channelJobs.writerHeld,
        operationStatus: agentOperations.status,
        createdAt: channelJobs.createdAt,
        publicationRevoked: channelJobs.publicationRevoked,
      })
      .from(channelJobs)
      .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
      .where(
        and(
          eq(channelJobs.channelId, channelId),
          options.threadId
            ? eq(channelJobs.threadId, options.threadId)
            : isNull(channelJobs.threadId),
        ),
      )
      .orderBy(desc(channelJobs.createdAt))
      .limit(200),
  ]);
  if (options.threadId && !threads.some((thread) => thread.id === options.threadId))
    throw new ChannelError('NOT_FOUND', 'Thread not found');
  const thread = threads.find((entry) => entry.id === options.threadId);
  const [rootMessage] = thread
    ? await tx
        .select(publicMessageColumns)
        .from(channelMessages)
        .leftJoin(users, eq(users.id, channelMessages.userId))
        .leftJoin(agents, eq(agents.id, channelMessages.agentId))
        .where(
          and(
            eq(channelMessages.channelId, channelId),
            eq(channelMessages.id, thread.rootMessageId),
          ),
        )
    : [];
  const page = reversed.slice(0, limit).reverse();
  const quoteIds = [
    ...new Set(
      [...page, ...(rootMessage ? [rootMessage] : [])].flatMap((message) =>
        message.replyToId ? [message.replyToId] : [],
      ),
    ),
  ];
  const quoted = quoteIds.length
    ? await tx
        .select(publicMessageColumns)
        .from(channelMessages)
        .leftJoin(users, eq(users.id, channelMessages.userId))
        .leftJoin(agents, eq(agents.id, channelMessages.agentId))
        .where(and(eq(channelMessages.channelId, channelId), inArray(channelMessages.id, quoteIds)))
    : [];
  const quotes = new Map(
    quoted.map((row) => {
      const { author, content, id, sequence, threadId } = publicMessage(row, []);
      return [id, { author, content: content.slice(0, 240), id, sequence, threadId }] as const;
    }),
  );
  const files = await fileIdsByMessage(tx, [
    ...page.map((message) => message.id),
    ...(rootMessage ? [rootMessage.id] : []),
  ]);
  const ids = [...new Set([...files.values()].flat())];
  const attachments = ids.length
    ? await tx
        .select({
          id: fileTable.id,
          name: fileTable.name,
          fileType: fileTable.fileType,
          size: fileTable.size,
          url: fileTable.url,
        })
        .from(fileTable)
        .where(inArray(fileTable.id, ids))
    : [];
  return {
    attachments,
    hasMore: reversed.length > limit,
    jobs,
    members,
    threads,
    rootMessage: rootMessage
      ? {
          ...publicMessage(rootMessage, files.get(rootMessage.id) ?? []),
          replyTo: rootMessage.replyToId ? (quotes.get(rootMessage.replyToId) ?? null) : null,
        }
      : null,
    messages: page.map((message) => ({
      ...publicMessage(message, files.get(message.id) ?? []),
      replyTo: message.replyToId ? (quotes.get(message.replyToId) ?? null) : null,
    })),
  };
};

/** A branch freezes its main-line boundary; opening it never creates or replays a job. */
export const createChannelThread = async (
  tx: Transaction,
  channelId: string,
  input: { followerMemberIds?: string[]; rootMessageId: string },
) => {
  const [root] = await tx
    .select()
    .from(channelMessages)
    .where(
      and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, input.rootMessageId)),
    );
  if (!root || root.threadId)
    throw new ChannelError('BAD_REQUEST', 'Choose a message on the main timeline');
  const [existing] = await tx
    .select()
    .from(channelThreads)
    .where(
      and(
        eq(channelThreads.channelId, channelId),
        eq(channelThreads.rootMessageId, root.id),
        notTrashed(channelThreads.isDeleted),
      ),
    );
  if (existing) return existing;
  // Explicit selections are validated; inferred recipients may have left since the root.
  const followers = input.followerMemberIds
    ? await activeMembers(tx, channelId, input.followerMemberIds)
    : root.recipientMemberIds.length
      ? await tx
          .select({ id: channelMembers.id })
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.channelId, channelId),
              eq(channelMembers.status, 'active'),
              inArray(channelMembers.id, root.recipientMemberIds),
            ),
          )
      : [];
  // An Agent reply has no recipients. Branching from it must still carry its author
  // into the thread, without substituting a removed or rebound member's new Agent.
  const authors = root.agentId
    ? await tx
        .select({ id: channelMembers.id })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, channelId),
            eq(channelMembers.agentId, root.agentId),
            eq(channelMembers.actorType, 'agent'),
            eq(channelMembers.status, 'active'),
          ),
        )
    : [];
  const [thread] = await tx
    .insert(channelThreads)
    .values({
      channelId,
      followerMemberIds: [...new Set([...followers, ...authors].map((member) => member.id))],
      rootMessageId: root.id,
      rootSequence: root.sequence,
    })
    .returning();
  return thread;
};
