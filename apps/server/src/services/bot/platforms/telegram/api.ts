import debug from 'debug';

import type { TelegramInputRichMessage, TelegramRichUpload } from './richMessage';

const log = debug('bot-platform:telegram:client');

export const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Hard cap per Telegram API request. Vercel functions have a finite total
 * runtime and `handleCompletion` may serially call this once per chunk plus
 * a possible edit→create fallback, so unbounded `fetch` (no default timeout
 * in undici beyond ~5min) can wedge the whole callback.
 */
const TELEGRAM_FETCH_TIMEOUT_MS = 8000;

/**
 * Multipart uploads carry up to tens of MB of binary payload, which cannot
 * fit inside the 8s JSON-call budget — a 20MB document upload alone can take
 * longer than that on a cold serverless egress path. Uploads happen on the
 * proactive-push path (one per request), not the per-chunk reply loop, so a
 * generous cap does not threaten the function budget the same way.
 */
const TELEGRAM_UPLOAD_TIMEOUT_MS = 60_000;

const isParseEntitiesError = (error: unknown): boolean => {
  const msg = (error as { message?: string } | null)?.message;
  return typeof msg === 'string' && msg.includes("can't parse entities");
};

const stripHTML = (html: string): string => {
  let sanitized = html;
  let previous: string;

  do {
    previous = sanitized;
    sanitized = sanitized
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&')
      .replaceAll(/<\/?[a-z][^>]*>/gi, '');
  } while (sanitized !== previous);

  return sanitized;
};

/**
 * Thrown when an edit cannot be retried (message is gone or beyond the edit
 * window). Callers should fall back to sending a new message so the user
 * still receives the content.
 */
export class TelegramEditUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramEditUnavailableError';
  }
}

/**
 * Transient network failures worth a single retry: connection-level timeouts
 * (ETIMEDOUT, ECONNRESET, EAI_AGAIN), undici's generic "fetch failed", and
 * the AbortSignal.timeout firing. Sustained outages will fail twice and bail.
 */
const isTransientNetworkError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: string; code?: string; message?: string; cause?: unknown };
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const codes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_SOCKET']);
  if (err.code && codes.has(err.code)) return true;
  // undici wraps low-level errors as `TypeError: fetch failed` with a `cause`.
  if (err.message?.includes('fetch failed')) return true;
  if (err.cause && typeof err.cause === 'object') {
    const cause = err.cause as { code?: string; errors?: Array<{ code?: string }> };
    if (cause.code && codes.has(cause.code)) return true;
    if (cause.errors?.some((e) => e?.code && codes.has(e.code))) return true;
  }
  return false;
};

const isEditUnavailable = (error: unknown): boolean => {
  const msg = (error as { message?: string } | null)?.message;
  if (typeof msg !== 'string') return false;
  return (
    msg.includes('message to edit not found') ||
    msg.includes("message can't be edited") ||
    msg.includes('MESSAGE_ID_INVALID')
  );
};

/**
 * Lightweight platform client for Telegram Bot API operations used by
 * callback and extension flows outside the Chat SDK adapter surface.
 */
export class TelegramApi {
  private readonly botToken: string;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  async sendMessage(chatId: string | number, text: string): Promise<{ message_id: number }> {
    log('sendMessage: chatId=%s', chatId);
    if (!text.trim()) {
      // Telegram rejects empty / whitespace-only messages with 400 "message
      // text is empty". Throwing here surfaces the bug at the call site
      // instead of letting an upstream silent-catch drop the user's reply.
      throw new Error('Telegram API sendMessage skipped: text is empty');
    }
    const truncated = this.truncateText(text);
    try {
      const data = await this.call('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: truncated,
      });
      return { message_id: data.result.message_id };
    } catch (error) {
      // Operational HTML can contain an unbalanced tag. Retry as plain text
      // so account-linking and pairing prompts still reach the user.
      if (!isParseEntitiesError(error)) throw error;
      log('sendMessage: HTML parse failed, retrying as plain text. chatId=%s', chatId);
      const data = await this.call('sendMessage', {
        chat_id: chatId,
        text: this.truncateText(stripHTML(text)),
      });
      return { message_id: data.result.message_id };
    }
  }

  async sendRichMessage(params: {
    chatId: string | number;
    messageThreadId?: number;
    richMessage: TelegramInputRichMessage;
    uploads?: TelegramRichUpload[];
  }): Promise<{ message_id: number }> {
    log('sendRichMessage: chatId=%s, uploads=%d', params.chatId, params.uploads?.length ?? 0);
    const fields = {
      chat_id: params.chatId,
      message_thread_id: params.messageThreadId,
      rich_message: JSON.stringify(params.richMessage),
    };
    const data = params.uploads?.length
      ? await this.callMultipartMany('sendRichMessage', fields, params.uploads)
      : await this.call('sendRichMessage', {
          chat_id: params.chatId,
          message_thread_id: params.messageThreadId,
          rich_message: params.richMessage,
        });
    return { message_id: data.result.message_id };
  }

  async sendRichMessageDraft(params: {
    canStop?: boolean;
    chatId: string | number;
    draftId: number;
    keepOnStop?: boolean;
    messageThreadId?: number;
    richMessage: TelegramInputRichMessage;
  }): Promise<void> {
    log('sendRichMessageDraft: chatId=%s, draftId=%d', params.chatId, params.draftId);
    await this.call('sendRichMessageDraft', {
      can_stop: params.canStop,
      chat_id: params.chatId,
      draft_id: params.draftId,
      keep_on_stop: params.keepOnStop,
      message_thread_id: params.messageThreadId,
      rich_message: params.richMessage,
    });
  }

  async editRichMessageText(params: {
    chatId?: string | number;
    inlineMessageId?: string;
    messageId?: number;
    richMessage: TelegramInputRichMessage;
  }): Promise<void> {
    try {
      await this.call('editMessageText', {
        chat_id: params.chatId,
        inline_message_id: params.inlineMessageId,
        message_id: params.messageId,
        rich_message: params.richMessage,
      });
    } catch (error) {
      const message = (error as { message?: string } | null)?.message;
      if (message?.includes('message is not modified')) return;
      if (isEditUnavailable(error)) {
        throw new TelegramEditUnavailableError(
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }

  /**
   * Send a message with a single inline-keyboard URL button. Used by the
   * Messenger link flow to surface a "Link Account" CTA that opens the
   * verify-im page in the user's browser.
   */
  async sendMessageWithUrlButton(
    chatId: string | number,
    text: string,
    button: { text: string; url: string },
  ): Promise<{ message_id: number }> {
    log('sendMessageWithUrlButton: chatId=%s', chatId);
    const data = await this.call('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: button.text, url: button.url }]],
      },
      text: this.truncateText(text),
    });
    return { message_id: data.result.message_id };
  }

  /**
   * Send a message with inline-keyboard callback buttons. Each button carries
   * `callback_data` (≤ 64 bytes) which the bot receives back via webhook
   * `callback_query` when the user taps it.
   */
  async sendMessageWithCallbackKeyboard(
    chatId: string | number,
    text: string,
    keyboard: Array<Array<{ callback_data: string; text: string }>>,
  ): Promise<{ message_id: number }> {
    log('sendMessageWithCallbackKeyboard: chatId=%s', chatId);
    const data = await this.call('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
      text: this.truncateText(text),
    });
    return { message_id: data.result.message_id };
  }

  /**
   * Replace an existing message's text + inline keyboard. Used to re-render a
   * picker after one of its options is selected (e.g. agent switch).
   */
  async editMessageWithCallbackKeyboard(
    chatId: string | number,
    messageId: number,
    text: string,
    keyboard: Array<Array<{ callback_data: string; text: string }>>,
  ): Promise<void> {
    log('editMessageWithCallbackKeyboard: chatId=%s, messageId=%s', chatId, messageId);
    try {
      await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
        text: this.truncateText(text),
      });
    } catch (error: any) {
      if (error?.message?.includes('message is not modified')) return;
      throw error;
    }
  }

  /**
   * Acknowledge a callback_query update. Telegram requires this within 30s of
   * the user tapping a button, otherwise the loading spinner on the button
   * stays forever. Pass `text` to show a toast notification to the user.
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    log('answerCallbackQuery: id=%s', callbackQueryId);
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async sendChatAction(chatId: string | number, action = 'typing'): Promise<void> {
    log('sendChatAction: chatId=%s, action=%s', chatId, action);
    await this.call('sendChatAction', { action, chat_id: chatId });
  }

  async deleteMessage(chatId: string | number, messageId: number): Promise<void> {
    log('deleteMessage: chatId=%s, messageId=%s', chatId, messageId);
    await this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  async setMessageReaction(
    chatId: string | number,
    messageId: number,
    emoji: string,
  ): Promise<void> {
    log('setMessageReaction: chatId=%s, messageId=%s, emoji=%s', chatId, messageId, emoji);
    await this.call('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ emoji, type: 'emoji' }],
    });
  }

  async removeMessageReaction(chatId: string | number, messageId: number): Promise<void> {
    log('removeMessageReaction: chatId=%s, messageId=%s', chatId, messageId);
    await this.call('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction: [],
    });
  }

  async setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    log('setMyCommands: %d commands', commands.length);
    await this.call('setMyCommands', { commands });
  }

  // ==================== Pin Operations ====================

  async pinChatMessage(
    chatId: string | number,
    messageId: number,
    disableNotification?: boolean,
  ): Promise<void> {
    log('pinChatMessage: chatId=%s, messageId=%s', chatId, messageId);
    await this.call('pinChatMessage', {
      chat_id: chatId,
      disable_notification: disableNotification ?? true,
      message_id: messageId,
    });
  }

  async unpinChatMessage(chatId: string | number, messageId: number): Promise<void> {
    log('unpinChatMessage: chatId=%s, messageId=%s', chatId, messageId);
    await this.call('unpinChatMessage', {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  // ==================== Chat / Channel Info ====================

  async getChat(chatId: string | number): Promise<any> {
    log('getChat: chatId=%s', chatId);
    const data = await this.call('getChat', { chat_id: chatId });
    return data.result;
  }

  async getChatMember(chatId: string | number, userId: number): Promise<any> {
    log('getChatMember: chatId=%s, userId=%s', chatId, userId);
    const data = await this.call('getChatMember', { chat_id: chatId, user_id: userId });
    return data.result;
  }

  // ==================== File Download ====================

  /**
   * Resolve a Telegram `file_id` to a `file_path` so it can be downloaded.
   * Two-step Bot API flow: getFile → fetch from /file/bot<token>/<file_path>.
   */
  async getFile(fileId: string): Promise<{ file_path?: string; file_size?: number }> {
    log('getFile: fileId=%s', fileId);
    const data = await this.call('getFile', { file_id: fileId });
    return data.result;
  }

  /**
   * Download a Telegram media attachment by file_id.
   *
   * The Chat SDK's `Attachment.fetchData` closure is stripped when messages
   * are serialized into the queue/Redis (functions are not JSON-serializable),
   * so we need a way to re-download the original media after a debounce
   * round-trip. This is the platform-native fallback path used by
   * `TelegramWebhookClient.refetchAttachment`.
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    const file = await this.getFile(fileId);
    if (!file.file_path) {
      throw new Error(`Telegram getFile returned no file_path for ${fileId}`);
    }
    const url = `${TELEGRAM_API_BASE}/file/bot${this.botToken}/${file.file_path}`;
    log('downloadFile: fileId=%s, file_path=%s', fileId, file.file_path);
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Failed to download Telegram file ${fileId}: ${response.status} ${text}`.trim(),
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  // ==================== Forum Topics (Threads) ====================

  async createForumTopic(
    chatId: string | number,
    name: string,
  ): Promise<{ message_thread_id: number }> {
    log('createForumTopic: chatId=%s, name=%s', chatId, name);
    const data = await this.call('createForumTopic', {
      chat_id: chatId,
      name: name.slice(0, 128), // Telegram forum topic name limit
    });
    return { message_thread_id: data.result.message_thread_id };
  }

  async sendMessageToTopic(
    chatId: string | number,
    topicId: number,
    text: string,
  ): Promise<{ message_id: number }> {
    log('sendMessageToTopic: chatId=%s, topicId=%s', chatId, topicId);
    const data = await this.call('sendMessage', {
      chat_id: chatId,
      message_thread_id: topicId,
      parse_mode: 'HTML',
      text: this.truncateText(text),
    });
    return { message_id: data.result.message_id };
  }

  // ==================== Polls ====================

  async sendPoll(
    chatId: string | number,
    question: string,
    options: string[],
    isAnonymous?: boolean,
    allowsMultipleAnswers?: boolean,
  ): Promise<{ message_id: number; poll_id?: string }> {
    log('sendPoll: chatId=%s, question=%s', chatId, question);
    const data = await this.call('sendPoll', {
      allows_multiple_answers: allowsMultipleAnswers ?? false,
      chat_id: chatId,
      is_anonymous: isAnonymous ?? true,
      options: options.map((text) => ({ text })),
      question,
    });
    return {
      message_id: data.result.message_id,
      poll_id: data.result.poll?.id,
    };
  }

  // ------------------------------------------------------------------

  private truncateText(text: string): string {
    // Telegram message limit is 4096 characters
    if (text.length > 4096) return text.slice(0, 4093) + '...';
    return text;
  }

  private async call(method: string, body: Record<string, unknown>): Promise<any> {
    const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/${method}`;
    const payload = JSON.stringify(body);

    const attempt = async (): Promise<any> => {
      // Cap each request so a slow Telegram doesn't eat the whole Vercel
      // function budget (multiple chunks call this serially during reply).
      const response = await fetch(url, {
        body: payload,
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text();
        log('Telegram API error: method=%s, status=%d, body=%s', method, response.status, text);
        throw new Error(`Telegram API ${method} failed: ${response.status} ${text}`);
      }

      const data = await response.json();
      // Telegram can return HTTP 200 with {"ok": false, ...} for logical errors
      if (data.ok === false) {
        const desc = data.description || 'Unknown error';
        log(
          'Telegram API logical error: method=%s, error_code=%d, description=%s',
          method,
          data.error_code,
          desc,
        );
        throw new Error(`Telegram API ${method} failed: ${data.error_code} ${desc}`);
      }
      return data;
    };

    try {
      return await attempt();
    } catch (error) {
      if (!isTransientNetworkError(error)) throw error;
      log('Telegram API %s: transient network error, retrying once: %O', method, error);
      return await attempt();
    }
  }

  private async callMultipartMany(
    method: string,
    fields: Record<string, string | number | boolean | undefined>,
    files: TelegramRichUpload[],
  ): Promise<any> {
    const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/${method}`;

    const buildForm = (): FormData => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        form.append(key, String(value));
      }
      for (const file of files) {
        const blob = new Blob([new Uint8Array(file.buffer)], {
          type: file.mimeType ?? 'application/octet-stream',
        });
        form.append(file.fieldName, blob, file.filename);
      }
      return form;
    };

    const attempt = async (): Promise<any> => {
      const response = await fetch(url, {
        body: buildForm(),
        method: 'POST',
        signal: AbortSignal.timeout(TELEGRAM_UPLOAD_TIMEOUT_MS),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Telegram API ${method} failed: ${response.status} ${text}`);
      }
      const data = await response.json();
      if (data.ok === false) {
        throw new Error(
          `Telegram API ${method} failed: ${data.error_code} ${data.description || 'Unknown error'}`,
        );
      }
      return data;
    };

    try {
      return await attempt();
    } catch (error) {
      if (!isTransientNetworkError(error)) throw error;
      log('Telegram API %s multipart: transient network error, retrying once: %O', method, error);
      return await attempt();
    }
  }

  // ==================== Guest Mode ====================

  /**
   * Reply to a Guest Mode summon. The result is posted as an inline message
   * in a chat the bot is not a member of. Returns `inline_message_id` for
   * later edits.
   */
  async answerGuestQuery(
    guestQueryId: string,
    result: Record<string, unknown>,
  ): Promise<{ inline_message_id: string }> {
    log('answerGuestQuery: id=%s, type=%s', guestQueryId, result.type);
    const data = await this.call('answerGuestQuery', {
      guest_query_id: guestQueryId,
      result,
    });
    const inlineMessageId = data.result?.inline_message_id;
    if (typeof inlineMessageId !== 'string' || !inlineMessageId) {
      throw new Error('Telegram API answerGuestQuery did not return inline_message_id');
    }
    return { inline_message_id: inlineMessageId };
  }

  /**
   * Build an article result for `answerGuestQuery`. HTML parse failures
   * retry as plain text so a malformed LLM snippet still delivers.
   */
  async answerGuestArticle(
    guestQueryId: string,
    text: string,
    extra?: { replyMarkup?: unknown; title?: string },
  ): Promise<{ inline_message_id: string }> {
    const body = text.trim() ? this.truncateText(text) : '...';
    const build = (useHtml: boolean, value: string): Record<string, unknown> => ({
      id: 'guest-reply',
      input_message_content: {
        message_text: value,
        parse_mode: useHtml ? 'HTML' : undefined,
      },
      reply_markup: extra?.replyMarkup,
      title: extra?.title ?? 'LobeHub',
      type: 'article',
    });

    try {
      return await this.answerGuestQuery(guestQueryId, build(true, body));
    } catch (error) {
      if (!isParseEntitiesError(error)) throw error;
      log('answerGuestArticle: HTML parse failed, retrying as plain text');
      return this.answerGuestQuery(guestQueryId, build(false, this.truncateText(stripHTML(body))));
    }
  }

  async answerGuestRichArticle(
    guestQueryId: string,
    richMessage: TelegramInputRichMessage,
    extra?: { replyMarkup?: unknown; title?: string },
  ): Promise<{ inline_message_id: string }> {
    return this.answerGuestQuery(guestQueryId, {
      id: 'guest-reply',
      input_message_content: { rich_message: richMessage },
      reply_markup: extra?.replyMarkup,
      title: extra?.title ?? 'LobeHub',
      type: 'article',
    });
  }
}
