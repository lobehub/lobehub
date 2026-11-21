import { CHANNEL_URL } from '@lobechat/const';
import type { ChannelPublicMessage } from '@lobechat/types';

/** The Agent another Agent's report answers, when the message is such a report. */
export const exchangeAgentOf = (message: ChannelPublicMessage) =>
  !message.via && message.author.type === 'agent' ? message.receipt?.agent : undefined;

/**
 * Where the conversation a report came out of can be opened from. Only the person who asked is in
 * that conversation, so the line offers no link to everyone else.
 */
export const exchangeLinkOf = (message: ChannelPublicMessage) => {
  const agent = exchangeAgentOf(message);
  if (!agent || !message.receipt?.canOpen) return undefined;

  return CHANNEL_URL(message.receipt.channelId, null, null);
};
