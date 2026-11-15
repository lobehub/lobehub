import { channelMessageReceipt, channelMessageVia } from '@lobechat/types';
import { and, asc, count, desc, eq, getTableColumns, inArray, isNull, lt, sql } from 'drizzle-orm';

import {
  agentOperations,
  agents,
  channelJobs,
  channelMembers,
  channelMessages,
  channelThreads,
  files as fileTable,
  topics,
  users,
} from '../../schemas';
import type { Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { fileIdsByMessage } from './attachments';
import { activeMembers } from './delivery';
import { ChannelError } from './error';
import { externalWorksByMessage } from './works';

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
    receipt: isAgent ? null : (channelMessageReceipt(message.metadata) ?? null),
    via: isAgent
      ? null
      : (() => {
          const via = channelMessageVia(message.metadata);
          return via ? { ...via, avatar: null as string | null } : null;
        })(),
  };
};

/**
 * Avatars of the Agents named in `via`, which usually are not members of this Channel. An Agent
 * deleted since keeps the name the message recorded, without an avatar.
 */
const relayAgentAvatars = async (tx: Transaction, rows: MessageRow[]) => {
  const ids = [
    ...new Set(
      rows.flatMap((row) => {
        const via = row.routingStatus === 'reply' ? undefined : channelMessageVia(row.metadata);
        return via ? [via.agentId] : [];
      }),
    ),
  ];
  if (!ids.length) return new Map<string, string | null>();
  const found = await tx
    .select({ avatar: agents.avatar, id: agents.id })
    .from(agents)
    .where(inArray(agents.id, ids));
  return new Map(found.map(({ avatar, id }) => [id, avatar] as const));
};

const withRelayAvatar = <T extends { via?: { agentId: string; avatar: string | null } | null }>(
  message: T,
  avatars: Map<string, string | null>,
): T =>
  message.via
    ? { ...message, via: { ...message.via, avatar: avatars.get(message.via.agentId) ?? null } }
    : message;

/** Public projection only. Execution settings, drafts and internal messages never leave this boundary. */
/**
 * The Agent topic behind each published reply, for replies the viewer ran: the topic belongs to
 * the requester, so other members never learn its id.
 */
const sourceTopicsByMessage = async (
  tx: Transaction,
  channelId: string,
  messageIds: string[],
  viewerUserId: string | undefined,
) => {
  if (!viewerUserId || !messageIds.length)
    return new Map<string, { id: string; title: string | null }>();
  const rows = await tx
    .select({
      messageId: channelJobs.publishedMessageId,
      title: topics.title,
      topicId: topics.id,
    })
    .from(channelJobs)
    .innerJoin(topics, eq(topics.id, channelJobs.topicId))
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        inArray(channelJobs.publishedMessageId, messageIds),
        eq(topics.userId, viewerUserId),
        notTrashed(topics.isDeleted),
      ),
    );
  return new Map(rows.map((row) => [row.messageId!, { id: row.topicId, title: row.title }]));
};

const THREAD_PREVIEW_LENGTH = 240;

type ThreadSummary = {
  lastReply: Pick<ReturnType<typeof publicMessage>, 'author' | 'content' | 'createdAt' | 'id'>;
  replyCount: number;
};

/** Reply count and newest reply per thread, so a root can show what it branched into. */
const threadSummaries = async (tx: Transaction, channelId: string, threadIds: string[]) => {
  if (!threadIds.length) return new Map<string, ThreadSummary>();
  const scope = and(
    eq(channelMessages.channelId, channelId),
    inArray(channelMessages.threadId, threadIds),
  );
  const [counts, latest] = await Promise.all([
    tx
      .select({ replyCount: count(), threadId: channelMessages.threadId })
      .from(channelMessages)
      .where(scope)
      .groupBy(channelMessages.threadId),
    tx
      .selectDistinctOn([channelMessages.threadId], publicMessageColumns)
      .from(channelMessages)
      .leftJoin(users, eq(users.id, channelMessages.userId))
      .leftJoin(agents, eq(agents.id, channelMessages.agentId))
      .where(scope)
      .orderBy(asc(channelMessages.threadId), desc(channelMessages.sequence)),
  ]);
  const replyCounts = new Map(counts.map((row) => [row.threadId, row.replyCount]));
  return new Map<string, ThreadSummary>(
    latest.map((row) => {
      const { author, content, createdAt, id } = publicMessage(row, []);
      return [
        row.threadId!,
        {
          lastReply: { author, content: content.slice(0, THREAD_PREVIEW_LENGTH), createdAt, id },
          replyCount: replyCounts.get(row.threadId) ?? 0,
        },
      ];
    }),
  );
};

export const readChannelView = async (
  tx: Transaction,
  channelId: string,
  options: { before?: number; limit?: number; threadId?: string | null } = {},
  viewerUserId?: string,
) => {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 100));
  const [members, reversed, threads, jobs] = await Promise.all([
    tx
      .select({
        actorType: channelMembers.actorType,
        agentId: channelMembers.agentId,
        avatar: agents.avatar,
        // The same fallback routing uses: a Channel-specific description, else the Agent's own.
        description: sql<
          string | null
        >`coalesce(nullif(${channelMembers.description}, ''), ${agents.description})`,
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
        worktreeBranch: sql<string | null>`${channelJobs.executionConfig}->>'worktreeBranch'`,
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
  // Only main-timeline roots on this page show a thread card; other views skip the scan.
  const pageIds = new Set(page.map((message) => message.id));
  const summarized = options.threadId
    ? []
    : threads.filter((entry) => pageIds.has(entry.rootMessageId)).map((entry) => entry.id);
  const summaries = await threadSummaries(tx, channelId, summarized);
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
  const replyIds = [...page, ...(rootMessage ? [rootMessage] : [])].flatMap((message) =>
    message.routingStatus === 'reply' ? [message.id] : [],
  );
  const [sourceTopics, works, relayAvatars] = await Promise.all([
    sourceTopicsByMessage(tx, channelId, replyIds, viewerUserId),
    externalWorksByMessage(tx, channelId, replyIds),
    relayAgentAvatars(tx, [...page, ...(rootMessage ? [rootMessage] : [])]),
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
    threads: threads.map((entry) => {
      const title = entry.metadata?.title;
      const named = typeof title === 'string' && title ? { ...entry, title } : entry;
      return summarized.includes(entry.id)
        ? {
            ...named,
            lastReply: summaries.get(entry.id)?.lastReply ?? null,
            replyCount: summaries.get(entry.id)?.replyCount ?? 0,
          }
        : named;
    }),
    rootMessage: rootMessage
      ? {
          ...withRelayAvatar(
            publicMessage(rootMessage, files.get(rootMessage.id) ?? []),
            relayAvatars,
          ),
          sourceTopicId: sourceTopics.get(rootMessage.id)?.id ?? null,
          sourceTopicTitle: sourceTopics.get(rootMessage.id)?.title ?? null,
          works: works.get(rootMessage.id) ?? [],
          replyTo: rootMessage.replyToId ? (quotes.get(rootMessage.replyToId) ?? null) : null,
        }
      : null,
    messages: page.map((message) => ({
      ...withRelayAvatar(publicMessage(message, files.get(message.id) ?? []), relayAvatars),
      sourceTopicId: sourceTopics.get(message.id)?.id ?? null,
      sourceTopicTitle: sourceTopics.get(message.id)?.title ?? null,
      works: works.get(message.id) ?? [],
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
