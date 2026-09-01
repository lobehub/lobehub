import type { BotMessageAttachment, MessengerContent } from '../types';
import { messengerContentText } from '../types';
import type { TelegramApi } from './api';
import {
  getTelegramGuestSession,
  saveTelegramGuestSession,
  type TelegramGuestSession,
} from './guestSession';
import { prepareTelegramRichMessage } from './richMessage';
import { decodeGuestInlineMessageId, encodeGuestInlineMessageId } from './threadId';

export const deliverGuestCreate = async (
  api: TelegramApi,
  sessionScope: string,
  threadId: string,
  content: MessengerContent,
): Promise<{ id: string }> => {
  const text = messengerContentText(content);
  const attachments = typeof content === 'string' ? undefined : content.attachments;
  const session = await getTelegramGuestSession(sessionScope, threadId);
  if (!session || (!session.guestQueryId && !session.inlineMessageId)) {
    throw new Error(`Telegram guest reply has no session for thread ${threadId}`);
  }

  if (!session.inlineMessageId) {
    return answerGuestQuery(api, sessionScope, threadId, session, text, attachments);
  }

  return editExistingGuest(api, sessionScope, threadId, session, text, attachments, {
    replaceText: false,
  });
};

export const deliverGuestEdit = async (
  api: TelegramApi,
  sessionScope: string,
  threadId: string,
  messageId: string,
  content: MessengerContent,
): Promise<void> => {
  const text = messengerContentText(content);
  const attachments = typeof content === 'string' ? undefined : content.attachments;
  const session = (await getTelegramGuestSession(sessionScope, threadId)) ?? {
    guestQueryId: '',
  };
  const inlineFromId = decodeGuestInlineMessageId(messageId) ?? session.inlineMessageId;
  if (!inlineFromId) {
    throw new Error(`Telegram guest edit has no inline_message_id for thread ${threadId}`);
  }
  await editExistingGuest(
    api,
    sessionScope,
    threadId,
    { ...session, inlineMessageId: inlineFromId },
    text,
    attachments,
    { replaceText: true },
  );
};

const answerGuestQuery = async (
  api: TelegramApi,
  sessionScope: string,
  threadId: string,
  session: TelegramGuestSession,
  text: string,
  attachments: BotMessageAttachment[] | undefined,
): Promise<{ id: string }> => {
  const rich = await prepareTelegramRichMessage(text, attachments, { allowUploads: false });
  if (!rich.richMessage.markdown.trim()) {
    throw new Error('Telegram guest rich reply is empty');
  }
  const { inline_message_id: inlineMessageId } = await api.answerGuestRichArticle(
    session.guestQueryId,
    rich.richMessage,
  );

  await saveTelegramGuestSession(sessionScope, threadId, {
    ...session,
    inlineMessageId,
    lastText: text,
  });
  return { id: encodeGuestInlineMessageId(inlineMessageId) };
};

const editExistingGuest = async (
  api: TelegramApi,
  sessionScope: string,
  threadId: string,
  session: TelegramGuestSession,
  text: string,
  attachments: BotMessageAttachment[] | undefined,
  options: { replaceText: boolean },
): Promise<{ id: string }> => {
  const inlineMessageId = session.inlineMessageId!;
  let nextText = text;
  if (
    !options.replaceText &&
    session.lastText?.trim() &&
    text.trim() &&
    session.lastText !== text
  ) {
    const separator = '\n\n';
    nextText = `${session.lastText}${separator}${text}`;
  }
  const rich = await prepareTelegramRichMessage(nextText, attachments, { allowUploads: false });
  if (!rich.richMessage.markdown.trim()) {
    throw new Error('Telegram guest rich edit is empty');
  }
  await api.editRichMessageText({
    inlineMessageId,
    richMessage: rich.richMessage,
  });

  await saveTelegramGuestSession(sessionScope, threadId, {
    ...session,
    inlineMessageId,
    lastText: nextText,
  });
  return { id: encodeGuestInlineMessageId(inlineMessageId) };
};

/**
 * Convert a Chat SDK postable payload into the raw Markdown + attachment
 * shape used by Rich Message delivery.
 */
export const messengerContentFromPostable = (message: unknown): MessengerContent => {
  if (typeof message === 'string') {
    return message;
  }
  if (!message || typeof message !== 'object') return '';
  const record = message as {
    attachments?: Array<{
      data?: Buffer;
      mimeType?: string;
      name?: string;
      size?: number;
      type?: BotMessageAttachment['type'];
      url?: string;
    }>;
    markdown?: string;
    text?: string;
  };
  const rawText = record.markdown ?? record.text ?? '';
  const content = rawText;
  const attachments = record.attachments?.flatMap((att) => {
    if (!att.type) return [];
    return [
      {
        data: att.data?.toString('base64'),
        fetchUrl: att.url,
        mimeType: att.mimeType,
        name: att.name,
        size: att.size,
        type: att.type,
      } satisfies BotMessageAttachment,
    ];
  });
  if (!attachments?.length) return content;
  return { attachments, content };
};
