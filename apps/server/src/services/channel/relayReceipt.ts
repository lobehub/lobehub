import { CHANNEL_LIMITS, channelMessageVia, channelRelayOrigin } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { ChannelRepository } from '@/database/repositories/channel';
import { channelJobs, channelMembers, channelMessages, channels } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { ChannelService } from './ChannelService';

/**
 * Brings a reply to a relayed request back to the Agent that relayed it (`lobe-channel.sendMessage`
 * / `lh channel send`): posted in the Channel and branch the relay came from, as the same
 * requester, @mentioning that Agent so it wakes and tells the person what came back. The receipt
 * carries the answering Agent in `via`, so the run it wakes cannot relay it again: one hop each way.
 *
 * Best-effort: the reply is already published where it was asked. A relaying Agent or Channel
 * that is gone, an archived branch, or a requester who left simply gets no receipt.
 */
export const deliverRelayReceipt = async (
  db: LobeChatDatabase,
  params: { channelId: string; jobId: string; replyMessageId: string },
) => {
  const [row] = await db
    .select({
      channelTitle: channels.title,
      job: channelJobs,
      requestMetadata: channelMessages.metadata,
      requesterUserId: channelMembers.userId,
      workspaceId: channels.workspaceId,
    })
    .from(channelJobs)
    .innerJoin(channels, eq(channels.id, channelJobs.channelId))
    .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
    .innerJoin(channelMembers, eq(channelMembers.id, channelJobs.requesterMemberId))
    .where(and(eq(channelJobs.channelId, params.channelId), eq(channelJobs.id, params.jobId)))
    .limit(1);
  const relay = row && channelMessageVia(row.requestMetadata);
  const origin = row && channelRelayOrigin(row.requestMetadata);
  if (!row || !relay || !origin || !row.requesterUserId || !row.job.manifest) return;

  const [reply] = await db
    .select({ content: channelMessages.content })
    .from(channelMessages)
    .where(eq(channelMessages.id, params.replyMessageId))
    .limit(1);
  if (!reply?.content.trim()) return;

  const workspaceId = row.workspaceId ?? undefined;
  const source = (
    await new ChannelRepository(db, row.requesterUserId, workspaceId).directory()
  ).find(({ channel }) => channel.id === origin.channelId);
  const relaying = source?.agents.find((agent) => agent.agentId === relay.agentId);
  if (!relaying) return;

  const lead = `@${relaying.name} `;
  const answered = row.job.manifest.self;
  await new ChannelService(db, row.requesterUserId, workspaceId).send(origin.channelId, {
    content: lead + reply.content.slice(0, CHANNEL_LIMITS.contentLength - lead.length),
    mentions: [relaying.memberId],
    metadata: {
      receipt: {
        channelId: params.channelId,
        channelTitle: row.channelTitle ?? '',
        messageId: params.replyMessageId,
      },
      via: { agentId: answered.agentId, name: answered.name },
    },
    requestKey: `relay-receipt:${params.replyMessageId}`,
    threadId: origin.threadId,
  });
};
