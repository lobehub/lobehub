import type { BotMessageAttachment, MessengerContent } from '../types';
import { messengerContentText } from '../types';
import type { BotWebhookOutboundAttachment, BotWebhookOutboundMessage } from './protocol';
import { decodeWebhookThreadId } from './protocol';

type OutboundAttachmentInput = Pick<
  BotMessageAttachment,
  'data' | 'fetchUrl' | 'mimeType' | 'name' | 'size' | 'type'
>;

/** A URL is handed over as-is; bytes without one go inline as base64. */
export const toOutboundAttachment = (
  attachment: OutboundAttachmentInput,
): BotWebhookOutboundAttachment => ({
  ...(attachment.fetchUrl ? { url: attachment.fetchUrl } : { data: attachment.data }),
  ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
  ...(attachment.name ? { name: attachment.name } : {}),
  ...(attachment.size !== undefined ? { size: attachment.size } : {}),
  type: attachment.type,
});

/** The `data` of a `bot.message.*` event for one reply in `platformThreadId`. */
export const toOutboundMessage = (
  platformThreadId: string,
  messageId: string,
  content: MessengerContent,
  replyTo: string | null = null,
): BotWebhookOutboundMessage => {
  const thread = decodeWebhookThreadId(platformThreadId);
  const attachments = typeof content === 'string' ? [] : (content.attachments ?? []);
  return {
    attachments: attachments
      .filter((attachment) => attachment.fetchUrl || attachment.data)
      .map(toOutboundAttachment),
    conversationId: thread.conversationId,
    isDirect: thread.isDirect,
    messageId,
    replyTo,
    text: messengerContentText(content),
    threadId: thread.threadId ?? null,
  };
};
