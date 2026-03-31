import debug from 'debug';

const log = debug('bot-platform:telegram:client');

export const TELEGRAM_API_BASE = 'https://api.telegram.org';

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
    const data = await this.call('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: this.truncateText(text),
    });
    return { message_id: data.result.message_id };
  }

  async editMessageText(chatId: string | number, messageId: number, text: string): Promise<void> {
    log('editMessageText: chatId=%s, messageId=%s', chatId, messageId);
    try {
      await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        text: this.truncateText(text),
      });
    } catch (error: any) {
      // Telegram returns 400 when the new content is identical to the current message — safe to ignore
      if (error?.message?.includes('message is not modified')) return;
      throw error;
    }
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
