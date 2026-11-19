import type { ChannelContextMessage, ChannelInputManifest } from '@lobechat/types';
import {
  agentDisplayName,
  CHANNEL_DELETED_AGENT_NAME,
  CHANNEL_DELETED_USER_NAME,
  channelMessageReceipt,
  channelMessageVia,
} from '@lobechat/types';
import { and, asc, count, desc, eq, gt, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';

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

/** Freeze the public history cutoff and branch for this request. */
export const buildManifest = (params: {
  job: ChannelJobItem;
  member: ChannelMemberItem;
  /** A deferred follow-up's view of the primary responder's published reply. */
  primaryReplyMessageId?: string;
  request: ChannelMessageItem;
  thread: ChannelThreadItem | null;
}): ChannelInputManifest => {
  const { job, member, primaryReplyMessageId, request, thread } = params;

  return {
    // Jobs inherit the request's branch, so the request itself always sorts last.
    cutoffSequence: request.sequence,
    ...(primaryReplyMessageId && { primaryReplyMessageId }),
    requestMessageId: request.id,
    requesterMemberId: job.requesterMemberId,
    self: { agentId: member.agentId!, memberId: member.id, name: member.name ?? 'Agent' },
    threadId: job.threadId,
    threadRootSequence: thread?.rootSequence ?? null,
  };
};

/** The branch messages a manifest covers; see {@link buildManifest}. */
const manifestScope = (channelId: string, manifest: ChannelInputManifest) => {
  const { threadId, threadRootSequence } = manifest;
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
          eq(channelMessages.id, manifest.requestMessageId),
          and(
            isNull(channelMessages.threadId),
            sql`${channelMessages.id} IN (SELECT ${channelJobs.messageId} FROM ${channelJobs} WHERE ${channelJobs.channelId} = ${channelId} AND ${channelJobs.threadId} = ${threadId})`,
          ),
          and(
            isNull(channelMessages.threadId),
            sql`${channelMessages.id} = (SELECT request.reply_to_id FROM channel_messages AS request WHERE request.id = ${manifest.requestMessageId} AND request.thread_id IS NULL)`,
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
  options: { beforeSequence?: number; limit?: number; messageId?: string } = {},
): Promise<ChannelContextMessage[]> => {
  const scope = and(
    manifestScope(channelId, manifest),
    options.beforeSequence === undefined
      ? undefined
      : lt(channelMessages.sequence, options.beforeSequence),
    options.messageId ? eq(channelMessages.id, options.messageId) : undefined,
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
    return {
      author: {
        id: isAgent ? message.agentId : message.userId,
        name: isAgent
          ? message.agentId
            ? agentDisplayName({ name: message.agentName, title: message.agentTitle }, 'Agent')
            : CHANNEL_DELETED_AGENT_NAME
          : message.fullName || message.username || CHANNEL_DELETED_USER_NAME,
        type: isAgent ? 'agent' : 'user',
      },
      content: message.content,
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
