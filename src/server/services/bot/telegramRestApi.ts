import debug from 'debug';

const log = debug('lobe-server:bot:telegram-rest');

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Lightweight wrapper around the Telegram Bot API.
 * Used by bot-callback webhooks to update messages directly
 * (bypassing the Chat SDK adapter).
 */
export class TelegramRestApi {
  private readonly botToken: string;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  async sendMessage(chatId: string | number, text: string): Promise<{ message_id: number }> {
    log('sendMessage: chatId=%s', chatId);
    const data = await this.call('sendMessage', {
      chat_id: chatId,
      text: this.truncateText(text),
    });
    return { message_id: data.result.message_id };
  }

  async editMessageText(chatId: string | number, messageId: number, text: string): Promise<void> {
    log('editMessageText: chatId=%s, messageId=%s', chatId, messageId);
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: this.truncateText(text),
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

  // ------------------------------------------------------------------

  private truncateText(text: string): string {
    // Telegram message limit is 4096 characters
    if (text.length > 4096) return text.slice(0, 4093) + '...';
    return text;
  }

  private async call(method: string, body: Record<string, unknown>): Promise<any> {
    const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/${method}`;

    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
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
  }
}
