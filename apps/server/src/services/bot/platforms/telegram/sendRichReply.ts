import debug from 'debug';

import type { BotMessageAttachment } from '../types';
import type { TelegramApi } from './api';
import { prepareTelegramRichMessage } from './richMessage';

const log = debug('bot-platform:telegram:rich-reply');

export interface SendTelegramRichReplyParams {
  attachments?: BotMessageAttachment[];
  chatId: string | number;
  messageThreadId?: number;
  text: string;
}

const emptyReplyError = new Error('Telegram rich message has no deliverable content');

const isDeterministicMediaError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes(' failed: 400 ') && !/\b400\b/.test(message)) return false;
  return !message.includes('method is not available');
};

/**
 * Send a Rich Message. Deterministic media/validation failures retry once as
 * a single text + download-link message so fallback cannot duplicate the
 * body. Transient transport errors are not degraded — Telegram may already
 * have accepted the first request.
 */
export const sendTelegramRichReply = async (
  telegram: TelegramApi,
  params: SendTelegramRichReplyParams,
): Promise<{ message_id?: number } | undefined> => {
  const send = async (linksOnly = false) => {
    const prepared = await prepareTelegramRichMessage(params.text, params.attachments, {
      linksOnly,
    });
    const markdown = prepared.richMessage.markdown.trim();
    const hasMedia = Boolean(prepared.richMessage.media?.length || prepared.uploads.length);
    if (!markdown && !hasMedia) {
      if (params.attachments?.length || params.text.trim()) throw emptyReplyError;
      return undefined;
    }
    // A dropped-attachment notice is not a real delivery. Attachment-only
    // replies that never produced media or a download link must fail closed.
    if (
      !params.text.trim() &&
      params.attachments?.length &&
      !hasMedia &&
      prepared.droppedAttachments.length === params.attachments.length
    ) {
      throw emptyReplyError;
    }
    const result = await telegram.sendRichMessage({
      chatId: params.chatId,
      messageThreadId: params.messageThreadId,
      richMessage: prepared.richMessage,
      uploads: prepared.uploads,
    });
    return result ?? {};
  };

  try {
    return await send();
  } catch (error) {
    if (error === emptyReplyError) throw error;
    if (!params.attachments?.length || !isDeterministicMediaError(error)) throw error;
    log('rich media rejected, retrying as download links in one message: %O', error);
    try {
      return await send(true);
    } catch (fallbackError) {
      if (fallbackError === emptyReplyError) throw error;
      throw fallbackError;
    }
  }
};
