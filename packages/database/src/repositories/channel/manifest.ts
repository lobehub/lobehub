import type { ChannelContextMessage, ChannelInputManifest } from '@lobechat/types';
import {
  agentDisplayName,
  CHANNEL_DELETED_AGENT_NAME,
  CHANNEL_DELETED_USER_NAME,
} from '@lobechat/types';
import { and, asc, eq, gt, isNull, lte, notExists, or } from 'drizzle-orm';

import type {
  ChannelJobItem,
  ChannelMemberItem,
  ChannelMessageItem,
  ChannelThreadItem,
} from '../../schemas';
import { agents, channelJobs, channelMessages, users } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { fileIdsByMessage } from './attachments';

/** Freeze the new public input window; a fresh topic receives the full branch. */
export const buildManifest = (params: {
  afterSequence: number;
  job: ChannelJobItem;
  member: ChannelMemberItem;
  request: ChannelMessageItem;
  thread: ChannelThreadItem | null;
}): ChannelInputManifest => {
  const { afterSequence, job, member, request, thread } = params;

  return {
    afterSequence,
    // Jobs inherit the request's branch, so the request itself always sorts last.
    cutoffSequence: request.sequence,
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
    gt(channelMessages.sequence, manifest.afterSequence),
    threadId
      ? or(eq(channelMessages.threadId, threadId), mainPrefix)
      : isNull(channelMessages.threadId),
  );
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
  topicId: string | null,
): Promise<ChannelContextMessage[]> => {
  const scope = and(
    manifestScope(channelId, manifest),
    // A continued topic already contains its own answers. They may have been published
    // after the next request was queued, so the input cursor alone cannot exclude them.
    manifest.afterSequence > 0 && topicId
      ? notExists(
          db
            .select({ id: channelJobs.id })
            .from(channelJobs)
            .where(
              and(
                eq(channelJobs.topicId, topicId),
                eq(channelJobs.publishedMessageId, channelMessages.id),
              ),
            ),
        )
      : undefined,
  );
  const visible = await db
    .select({
      agentId: channelMessages.agentId,
      agentName: agents.name,
      agentTitle: agents.title,
      fullName: users.fullName,
      routingStatus: channelMessages.routingStatus,
      userId: channelMessages.userId,
      username: users.username,
      content: channelMessages.content,
      id: channelMessages.id,
      sequence: channelMessages.sequence,
      threadId: channelMessages.threadId,
    })
    .from(channelMessages)
    .leftJoin(users, eq(users.id, channelMessages.userId))
    .leftJoin(agents, eq(agents.id, channelMessages.agentId))
    .where(scope)
    .orderBy(asc(channelMessages.sequence));
  const attachments = await fileIdsByMessage(
    db,
    db.select({ id: channelMessages.id }).from(channelMessages).where(scope),
  );

  return visible.map((message) => {
    const isAgent = message.routingStatus === 'reply';
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
      threadId: message.threadId,
    };
  });
};
