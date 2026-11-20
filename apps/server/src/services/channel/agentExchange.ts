import { CHANNEL_LIMITS, channelAgentExchange } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { ChannelRepository } from '@/database/repositories/channel';
import { channelJobs, channelMembers, channelMessages, channels } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { notifyChannel } from './notify';

/**
 * Posts what an Agent concluded from another Agent's answer where its asking began
 * (`ChannelMessagingService.askAgent`): in the person's conversation, as the Agent's own message
 * that wakes no one, linking back to the conversation between the Agents. Only a reply that
 * answers the other Agent's answer reports; replies to a person's request stay where they are.
 *
 * Best-effort: the reply is already published between the Agents. A Channel, Thread or Agent
 * membership that is gone where the asking began simply gets no report.
 */
export const reportAgentExchange = async (
  db: LobeChatDatabase,
  params: { channelId: string; jobId: string; replyMessageId: string },
) => {
  const [row] = await db
    .select({
      agentPairKey: channels.agentPairKey,
      channelTitle: channels.title,
      job: channelJobs,
      request: channelMessages,
      requesterUserId: channelMembers.userId,
      workspaceId: channels.workspaceId,
    })
    .from(channelJobs)
    .innerJoin(channels, eq(channels.id, channelJobs.channelId))
    .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
    .innerJoin(channelMembers, eq(channelMembers.id, channelJobs.requesterMemberId))
    .where(and(eq(channelJobs.channelId, params.channelId), eq(channelJobs.id, params.jobId)))
    .limit(1);
  if (
    !row?.agentPairKey ||
    !row.requesterUserId ||
    !row.job.manifest ||
    row.request.routingStatus !== 'reply' ||
    !row.request.replyToId
  )
    return;

  const [asked] = await db
    .select({ metadata: channelMessages.metadata })
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.channelId, params.channelId),
        eq(channelMessages.id, row.request.replyToId),
      ),
    )
    .limit(1);
  const origin = channelAgentExchange(asked?.metadata)?.origin;
  const [reply] = await db
    .select({ content: channelMessages.content })
    .from(channelMessages)
    .where(eq(channelMessages.id, params.replyMessageId))
    .limit(1);
  if (!origin || !reply?.content.trim()) return;
  // The Agent that answered, shown with the report ("Messages from <Agent>").
  const [answering] = row.request.agentId
    ? await db
        .select({ name: channelMembers.name })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, params.channelId),
            eq(channelMembers.agentId, row.request.agentId),
          ),
        )
        .limit(1)
    : [];

  await new ChannelRepository(db, row.requesterUserId, row.workspaceId).postAgentMessage(
    origin.channelId,
    {
      agentId: row.job.manifest.self.agentId,
      content: reply.content.slice(0, CHANNEL_LIMITS.contentLength),
      metadata: {
        receipt: {
          ...(row.request.agentId &&
            answering?.name && { agent: { agentId: row.request.agentId, name: answering.name } }),
          channelId: params.channelId,
          channelTitle: row.channelTitle,
          messageId: params.replyMessageId,
        },
      },
      requestKey: `agent-exchange:${params.replyMessageId}`,
      threadId: origin.threadId,
    },
  );
  await notifyChannel(db, origin.channelId);
};
