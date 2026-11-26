import type { ChannelAsk, ChannelAskAnswerItem, ChannelMessage } from '@lobechat/types';
import {
  channelAskAnswerText,
  channelMessageAsk,
  channelMessageDeletedAt,
  validateChannelAskAnswers,
} from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { channelMessages } from '../../schemas';
import type { Transaction } from '../../type';
import type { ChannelContacts } from './contacts';
import { noChannelContacts } from './contacts';
import { ChannelError } from './error';
import { sendMessage } from './send';
import { audit } from './transaction';
import type { ChannelAccess } from './types';

export interface ChannelAskAnswerInput {
  answers: ChannelAskAnswerItem[];
  messageId: string;
  /** Client retry key of the answer message. */
  requestKey: string;
}

export interface ChannelAskAnswered {
  /** The answered question, with its answer. */
  ask: ChannelAsk;
  /** The person's message carrying the answer. */
  reply: ChannelMessage;
}

/**
 * Answers an Agent's `ask` message. Only the requester it asked may answer, once: the answer is
 * posted as their reply to the question, which wakes the Agent that asked like any reply to an
 * Agent does, and the question is marked answered in the same transaction. A question a blocked
 * run asked (`ask.intervention`) wakes no one: the caller hands the answer to that run. A retry
 * of the same answer returns the message it already posted.
 */
export const answerAsk = async (
  tx: Transaction,
  access: ChannelAccess,
  input: ChannelAskAnswerInput,
  contacts: ChannelContacts = noChannelContacts,
): Promise<ChannelAskAnswered> => {
  const { channel, member } = access;
  const [message] = await tx
    .select()
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, channel.id), eq(channelMessages.id, input.messageId)))
    .for('update');
  const ask = message?.kind === 'ask' ? channelMessageAsk(message.metadata) : undefined;
  if (!message || !ask || channelMessageDeletedAt(message.metadata))
    throw new ChannelError('NOT_FOUND', 'Question not found');
  if (ask.requesterMemberId !== member.id)
    throw new ChannelError('FORBIDDEN', 'Only the person it asked can answer this question');

  if (ask.status === 'answered') {
    const [posted] = ask.answer?.messageId
      ? await tx
          .select()
          .from(channelMessages)
          .where(
            and(
              eq(channelMessages.channelId, channel.id),
              eq(channelMessages.id, ask.answer.messageId),
            ),
          )
      : [];
    if (posted?.requestKey === input.requestKey) return { ask, reply: posted };
    throw new ChannelError('CONFLICT', 'This question was already answered');
  }
  if (ask.status === 'closed')
    throw new ChannelError('CONFLICT', 'This question is closed: the Agent moved on without it');

  const answers = input.answers.map(({ other, selected }) => ({
    selected,
    ...(other?.trim() && { other: other.trim() }),
  }));
  const invalid = validateChannelAskAnswers(ask, answers);
  if (invalid) throw new ChannelError('BAD_REQUEST', invalid);

  // Quoting the Agent's question without mentions asks that Agent, in the question's branch. A
  // blocked run is still working on the request: its answer is for the record only.
  const reply = await sendMessage(
    tx,
    access,
    {
      content: channelAskAnswerText(ask, answers),
      replyToId: message.id,
      requestKey: input.requestKey,
      routing: 'fallback',
      ...(ask.intervention && { silent: true }),
      threadId: message.threadId,
    },
    contacts,
  );
  const answered: ChannelAsk = {
    ...ask,
    answer: {
      answeredAt: new Date().toISOString(),
      answers,
      memberId: member.id,
      messageId: reply.id,
    },
    status: 'answered',
  };
  await tx
    .update(channelMessages)
    .set({ metadata: { ...message.metadata, ask: answered } })
    .where(eq(channelMessages.id, message.id));
  await audit(tx, channel.id, 'ask_answered', message.id, { messageId: reply.id });
  return { ask: answered, reply };
};
