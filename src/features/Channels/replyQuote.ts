import type { ChannelPublicMessage } from '@lobechat/types';

/**
 * Only a person's reply quotes: an Agent reply's `replyToId` is the request it answers. A view
 * without `replyTo` (an older server, or a persisted copy) cannot tell a deleted original.
 */
export const showsReplyQuote = (message: ChannelPublicMessage) =>
  !!message.replyToId && message.routingStatus !== 'reply' && message.replyTo !== undefined;
