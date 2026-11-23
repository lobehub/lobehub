import type { ChannelContextMessage, ChannelInputManifest } from '@lobechat/types';
import {
  agentDisplayName,
  CHANNEL_DELETED_AGENT_NAME,
  CHANNEL_DELETED_USER_NAME,
  channelMessageReceipt,
  channelMessageReplyError,
  channelMessageVia,
} from '@lobechat/types';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import type {
  ChannelJobItem,
  ChannelMemberItem,
  ChannelMessageItem,
  ChannelThreadItem,
} from '../../schemas';
import { agents, channelJobs, channelMessages, users } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { agentTitleSql } from '../../utils/inboxAgent';
import { fileIdsByMessage } from './attachments';
import { isAgentAuthored } from './author';
import { messageStands } from './tombstone';

/** What other Agents read in place of a failed reply's card. */
export const replyErrorNote = (agentName: string) => `${agentName} did not finish this reply.`;

/** Freeze the public history cutoff and branch for this request. */
export const buildManifest = (params: {
  job: ChannelJobItem;
  member: ChannelMemberItem;
  /** Later requests from the same requester answered in this run, oldest first. */
  merged?: ChannelMessageItem[];
  /** A deferred follow-up's view of the primary responder's published reply. */
  primaryReplyMessageId?: string;
  request: ChannelMessageItem;
  /** The run continues the topic of this job's failed run. */
  resumed?: boolean;
  thread: ChannelThreadItem | null;
}): ChannelInputManifest => {
  const { job, member, merged = [], primaryReplyMessageId, request, resumed, thread } = params;
  const last = merged.at(-1) ?? request;

  return {
    // Jobs inherit the request's branch, so the last request always sorts last.
    cutoffSequence: last.sequence,
    ...(primaryReplyMessageId && { primaryReplyMessageId }),
    requestMessageId: last.id,
    ...(merged.length > 0 && {
      requestMessageIds: [request.id, ...merged.map((next) => next.id)],
    }),
    requesterMemberId: job.requesterMemberId,
    ...(resumed && { resumed: true }),
    self: { agentId: member.agentId!, memberId: member.id, name: member.name ?? 'Agent' },
    threadId: job.threadId,
    threadRootSequence: thread?.rootSequence ?? null,
  };
};

/** The branch messages a manifest covers; see {@link buildManifest}. */
const manifestScope = (channelId: string, manifest: ChannelInputManifest) => {
  const { threadId, threadRootSequence } = manifest;
  // Every request the run answers: a batch merges later requests into the first one's run, and
  // what each of them quotes is part of what it was asked.
  const requestIds = manifest.requestMessageIds?.length
    ? manifest.requestMessageIds
    : [manifest.requestMessageId];
  const mainPrefix =
    threadRootSequence === null
      ? undefined
      : and(isNull(channelMessages.threadId), lte(channelMessages.sequence, threadRootSequence));

  return and(
    eq(channelMessages.channelId, channelId),
    lte(channelMessages.sequence, manifest.cutoffSequence),
    // A message deleted after the manifest froze leaves the context it was in.
    messageStands(),
    threadId
      ? // A request on the main timeline continued in an earlier Thread sits after its root,
        // and so may the main-timeline message it quotes. Earlier requests continued there stay
        // part of the Thread's history for every later run in it.
        or(
          eq(channelMessages.threadId, threadId),
          mainPrefix,
          inArray(channelMessages.id, requestIds),
          and(
            isNull(channelMessages.threadId),
            sql`${channelMessages.id} IN (SELECT ${channelJobs.messageId} FROM ${channelJobs} WHERE ${channelJobs.channelId} = ${channelId} AND ${channelJobs.threadId} = ${threadId})`,
          ),
          and(
            isNull(channelMessages.threadId),
            sql`${channelMessages.id} IN (SELECT request.reply_to_id FROM channel_messages AS request WHERE request.id IN (${sql.join(
              requestIds.map((id) => sql`${id}`),
              sql`, `,
            )}) AND request.thread_id IS NULL AND request.reply_to_id IS NOT NULL)`,
          ),
        )
      : isNull(channelMessages.threadId),
  );
};

/**
 * How many messages of a manifest's branch fall strictly between two sequences, without some
 * ids: what a run's recent context leaves out.
 */
export const countManifestMessages = async (
  db: LobeChatDatabase | Transaction,
  channelId: string,
  manifest: ChannelInputManifest,
  range: { afterSequence: number; beforeSequence: number; excludeIds?: string[] },
): Promise<number> => {
  const [row] = await db
    .select({ value: count() })
    .from(channelMessages)
    .where(
      and(
        manifestScope(channelId, manifest),
        gt(channelMessages.sequence, range.afterSequence),
        lt(channelMessages.sequence, range.beforeSequence),
        range.excludeIds?.length ? notInArray(channelMessages.id, range.excludeIds) : undefined,
      ),
    );

  return row?.value ?? 0;
};

/**
 * The messages a manifest froze, oldest first. Needs no channel lock: Channel writes change
 * only the routing fields of a sent message, and sequences only grow, so nothing at or before
 * the cutoff changes. Author names and attachments are read at call time: a deleted account
 * reads as deleted and a deleted file is no longer listed.
 */
export const readManifestMessages = async (
  db: LobeChatDatabase | Transaction,
  channelId: string,
  manifest: ChannelInputManifest,
  options: {
    beforeSequence?: number;
    limit?: number;
    messageId?: string;
    /** Only these messages; an empty list reads none. */
    messageIds?: string[];
  } = {},
): Promise<ChannelContextMessage[]> => {
  const scope = and(
    manifestScope(channelId, manifest),
    options.beforeSequence === undefined
      ? undefined
      : lt(channelMessages.sequence, options.beforeSequence),
    options.messageId ? eq(channelMessages.id, options.messageId) : undefined,
    options.messageIds ? inArray(channelMessages.id, options.messageIds) : undefined,
  );
  const query = db
    .select({
      agentId: channelMessages.agentId,
      agentName: agents.name,
      agentTitle: agentTitleSql(),
      fullName: users.fullName,
      routingStatus: channelMessages.routingStatus,
      userId: channelMessages.userId,
      username: users.username,
      content: channelMessages.content,
      id: channelMessages.id,
      metadata: channelMessages.metadata,
      sequence: channelMessages.sequence,
      replyToId: channelMessages.replyToId,
      threadId: channelMessages.threadId,
    })
    .from(channelMessages)
    .leftJoin(users, eq(users.id, channelMessages.userId))
    .leftJoin(agents, eq(agents.id, channelMessages.agentId))
    .where(scope)
    .orderBy(options.limit ? desc(channelMessages.sequence) : asc(channelMessages.sequence))
    .$dynamic();
  const visible = options.limit ? await query.limit(options.limit) : await query;
  if (options.limit) visible.reverse();
  const attachments = await fileIdsByMessage(
    db,
    visible.map((message) => message.id),
  );

  return visible.map((message) => {
    const isAgent = isAgentAuthored(message);
    const via = isAgent ? undefined : channelMessageVia(message.metadata);
    const receipt = channelMessageReceipt(message.metadata);
    const name = isAgent
      ? message.agentId
        ? agentDisplayName({ name: message.agentName, title: message.agentTitle }, 'Agent')
        : CHANNEL_DELETED_AGENT_NAME
      : message.fullName || message.username || CHANNEL_DELETED_USER_NAME;
    return {
      author: {
        id: isAgent ? message.agentId : message.userId,
        name,
        type: isAgent ? 'agent' : 'user',
      },
      // A failed reply's card explains the failure to people; Agents only learn it did not finish.
      content:
        isAgent && channelMessageReplyError(message.metadata)
          ? replyErrorNote(name)
          : message.content,
      ...(attachments.has(message.id) && { fileIds: attachments.get(message.id) }),
      id: message.id,
      sequence: message.sequence,
      replyToId: message.replyToId,
      threadId: message.threadId,
      ...(receipt && { receipt }),
      ...(via && { via }),
    };
  });
};
