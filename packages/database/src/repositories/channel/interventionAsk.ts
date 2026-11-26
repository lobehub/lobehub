import type { ChannelAsk, ChannelAskInput } from '@lobechat/types';
import { channelAskFallbackText, channelMessageAsk } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { channelJobs, channelMembers, channelMessages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { postAgentMessage } from './post';
import { audit, withChannelLock } from './transaction';

/** Request key of the card a blocked run's question is mirrored to. */
export const interventionAskRequestKey = (operationId: string, toolCallId: string) =>
  `intervention-ask:${operationId}:${toolCallId}`;

export interface PostedInterventionAsk {
  channelId: string;
  messageId: string;
}

/**
 * Mirrors a question a heterogeneous run (Claude Code on a device) is blocked on into the
 * Channel it answers, as an `ask` card under the request: the requester sees and answers it where
 * they asked, instead of only in the run's topic. Only a running job asked by a person gets one,
 * as with `lobe-channel.askUser`. Idempotent per question; returns undefined when the run
 * serves no such job.
 */
export const postInterventionAsk = async (
  db: LobeChatDatabase,
  intervention: { operationId: string; toolCallId: string },
  input: ChannelAskInput,
): Promise<PostedInterventionAsk | undefined> => {
  const [job] = await db
    .select({ channelId: channelJobs.channelId, id: channelJobs.id })
    .from(channelJobs)
    .where(eq(channelJobs.operationId, intervention.operationId))
    .limit(1);
  if (!job) return;

  return withChannelLock(db, job.channelId, async (tx) => {
    const [row] = await tx
      .select({ job: channelJobs, requester: channelMembers })
      .from(channelJobs)
      .innerJoin(channelMembers, eq(channelMembers.id, channelJobs.requesterMemberId))
      .where(eq(channelJobs.id, job.id))
      .limit(1);
    const agentId = row?.job.manifest?.self.agentId;
    if (!row || row.job.status !== 'running' || !agentId) return;
    if (row.requester.actorType !== 'user' || row.requester.status !== 'active') return;

    const ask: ChannelAsk = {
      ...input,
      bodyLength: 0,
      intervention,
      requesterMemberId: row.requester.id,
      status: 'pending',
    };
    const message = await postAgentMessage(tx, job.channelId, {
      agentId,
      content: channelAskFallbackText(ask),
      kind: 'ask',
      metadata: { ask },
      replyToId: row.job.messageId,
      requestKey: interventionAskRequestKey(intervention.operationId, intervention.toolCallId),
      threadId: row.job.threadId,
    });
    return { channelId: job.channelId, messageId: message.id };
  });
};

/**
 * Closes a mirrored card once its run moved on without it: answered in the topic, timed out, or
 * ended. A card answered in the Channel stays answered. Returns the Channel when it changed.
 */
export const closeInterventionAsk = async (
  db: LobeChatDatabase,
  intervention: { operationId: string; toolCallId: string },
): Promise<string | undefined> => {
  const requestKey = interventionAskRequestKey(intervention.operationId, intervention.toolCallId);
  const [job] = await db
    .select({ channelId: channelJobs.channelId })
    .from(channelJobs)
    .where(eq(channelJobs.operationId, intervention.operationId))
    .limit(1);
  if (!job) return;

  return withChannelLock(db, job.channelId, async (tx) => {
    const [message] = await tx
      .select()
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.channelId, job.channelId),
          eq(channelMessages.requestKey, requestKey),
        ),
      )
      .for('update');
    const ask = message?.kind === 'ask' ? channelMessageAsk(message.metadata) : undefined;
    if (!message || ask?.status !== 'pending') return;
    await tx
      .update(channelMessages)
      .set({ metadata: { ...message.metadata, ask: { ...ask, status: 'closed' } } })
      .where(eq(channelMessages.id, message.id));
    await audit(tx, job.channelId, 'ask_closed', message.id);
    return job.channelId;
  });
};
