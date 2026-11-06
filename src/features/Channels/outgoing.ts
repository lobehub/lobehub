import type { ChannelPublicMember, ChannelPublicMessage } from '@lobechat/types';

import type { ChannelOutgoingMessage } from '@/store/channel';

import { memberName } from './memberName';

const OUTGOING_PREFIX = 'outgoing:';

export const outgoingMessageId = (message: Pick<ChannelOutgoingMessage, 'requestKey'>) =>
  `${OUTGOING_PREFIX}${message.requestKey}`;

/**
 * A message this tab sent, shaped like a stored one so the timeline groups and renders it the
 * same way. It is the viewer's own; the server has not routed it yet.
 */
export const presentOutgoingMessage = (
  message: ChannelOutgoingMessage,
  author: { member?: ChannelPublicMember; userId?: string },
): ChannelPublicMessage => ({
  agentId: null,
  author: {
    avatar: author.member?.userAvatar ?? null,
    id: author.userId ?? null,
    name: memberName(author.member, '') || null,
    type: 'user',
  },
  content: message.content,
  createdAt: message.createdAt,
  fileIds: message.fileIds,
  id: outgoingMessageId(message),
  mentions: message.mentions,
  recipientMemberIds: [],
  replyTo: message.replyTo ?? (message.replyToId ? null : undefined),
  replyToId: message.replyToId ?? null,
  routingStatus: 'pending',
  sequence: message.sent?.sequence ?? Number.MAX_SAFE_INTEGER,
  threadId: message.threadId,
  userId: author.userId ?? null,
});

/**
 * Changes whenever the feed gains a message at its end, stored or sent from this tab. The two
 * tails are tracked apart: a failed message stays last until retried or deleted, and replies
 * arriving above it must still be followed.
 */
export const timelineTail = (
  messages: Pick<ChannelPublicMessage, 'id'>[] | undefined,
  outgoing: { message: Pick<ChannelPublicMessage, 'id'> }[],
) => `${messages?.at(-1)?.id ?? ''}|${outgoing.at(-1)?.message.id ?? ''}`;
