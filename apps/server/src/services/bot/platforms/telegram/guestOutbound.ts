import { renderGuestCopy, renderGuestTruncated } from '../../replyTemplate';
import type { BotMessageAttachment, MessengerContent } from '../types';
import { messengerContentText } from '../types';
import type { TelegramApi } from './api';
import {
  getTelegramGuestSession,
  saveTelegramGuestSession,
  type TelegramGuestSession,
} from './guestSession';
import { prepareTelegramRichMessage, TELEGRAM_RICH_MESSAGE_LIMIT } from './richMessage';
import { decodeGuestInlineMessageId, encodeGuestInlineMessageId } from './threadId';

const escapeMarkdownLabel = (value: string): string => value.replaceAll(/([\\`*_[\]<>])/g, '\\$1');

const attachmentFallbackMarkdown = (
  attachment: BotMessageAttachment,
  index: number,
  locale: TelegramGuestSession['locale'],
): string => {
  const label = escapeMarkdownLabel(
    attachment.name?.trim().replaceAll(/\s+/g, ' ') || `Attachment ${index + 1}`,
  );
  if (!attachment.fetchUrl) {
    return `⚠️ **${label}** — _${renderGuestCopy('guestMediaUnavailable', locale)}_`;
  }
  const url = encodeURI(attachment.fetchUrl).replaceAll('(', '%28').replaceAll(')', '%29');
  return `📎 [${label}](${url})`;
};

interface PreparedGuestMarkdown {
  displayText: string;
  storedText: string;
  truncated: boolean;
}

const characterLength = (value: string): number => Array.from(value).length;

const sliceCharacters = (value: string, start: number, end?: number): string =>
  Array.from(value).slice(start, end).join('');

const prepareGuestMarkdown = (
  text: string,
  attachments: BotMessageAttachment[] | undefined,
  session: TelegramGuestSession,
  retainedTailLength = 0,
  retainTruncation = true,
): PreparedGuestMarkdown => {
  const fallbackLines =
    attachments?.flatMap((attachment, index) =>
      attachment.fetchUrl ? [] : [attachmentFallbackMarkdown(attachment, index, session.locale)],
    ) ?? [];
  const fallbackText = fallbackLines.join('\n');
  const displayText = [text.trim(), fallbackText].filter(Boolean).join('\n\n');
  if (
    characterLength(displayText) <= TELEGRAM_RICH_MESSAGE_LIMIT &&
    (!session.truncated || !retainTruncation)
  ) {
    return { displayText, storedText: text, truncated: false };
  }

  const notice = `_${renderGuestTruncated(TELEGRAM_RICH_MESSAGE_LIMIT, session.locale)}_`;
  const suffix = [notice, fallbackText].filter(Boolean).join('\n\n');
  const textBudget = Math.max(0, TELEGRAM_RICH_MESSAGE_LIMIT - characterLength(suffix) - 2);
  const tailLength = Math.min(retainedTailLength, textBudget);
  const textLength = characterLength(text);
  const storedText =
    textLength > textBudget
      ? `${sliceCharacters(text, 0, textBudget - tailLength)}${
          tailLength > 0 ? sliceCharacters(text, -tailLength) : ''
        }`
      : text;

  return {
    displayText: [storedText, suffix].filter(Boolean).join('\n\n'),
    storedText,
    truncated: true,
  };
};

const prepareGuestRichMessage = async (
  text: string,
  attachments: BotMessageAttachment[] | undefined,
  session: TelegramGuestSession,
  retainedTailLength = 0,
  retainTruncation = true,
) => {
  const prepared = prepareGuestMarkdown(
    text,
    attachments,
    session,
    retainedTailLength,
    retainTruncation,
  );
  const { richMessage } = await prepareTelegramRichMessage(
    prepared.displayText,
    attachments?.filter((attachment) => attachment.fetchUrl),
    { linksOnly: true },
  );
  return { prepared, richMessage };
};

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
  const { prepared, richMessage } = await prepareGuestRichMessage(text, attachments, session);
  if (!richMessage.markdown.trim()) {
    throw new Error('Telegram guest rich reply is empty');
  }
  const { inline_message_id: inlineMessageId } = await api.answerGuestRichArticle(
    session.guestQueryId,
    richMessage,
  );

  await saveTelegramGuestSession(sessionScope, threadId, {
    ...session,
    inlineMessageId,
    lastText: prepared.storedText,
    truncated: prepared.truncated,
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
  let retainedTailLength = 0;
  if (
    !options.replaceText &&
    session.lastText?.trim() &&
    text.trim() &&
    session.lastText !== text
  ) {
    const separator = '\n\n';
    nextText = `${session.lastText}${separator}${text}`;
    retainedTailLength = characterLength(separator) + characterLength(text);
  }
  const { prepared, richMessage } = await prepareGuestRichMessage(
    nextText,
    attachments,
    session,
    retainedTailLength,
    !options.replaceText,
  );
  if (!richMessage.markdown.trim()) {
    throw new Error('Telegram guest rich edit is empty');
  }
  await api.editRichMessageText({
    inlineMessageId,
    richMessage,
  });

  await saveTelegramGuestSession(sessionScope, threadId, {
    ...session,
    inlineMessageId,
    lastText: prepared.storedText,
    truncated: prepared.truncated,
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
  const content = record.markdown ?? record.text ?? '';
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
