import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from 'chat';
import { Message, parseMarkdown } from 'chat';

import { WeixinApiClient } from './api';
import { WeixinFormatConverter } from './format-converter';
import type { WeixinAdapterConfig, WeixinRawMessage, WeixinThreadId, WeixinUpdate } from './types';

/**
 * WeChat (iLink) adapter for Chat SDK.
 *
 * Handles webhook requests forwarded by the long-polling monitor
 * and message operations via iLink Bot API.
 */
export class WeixinAdapter implements Adapter<WeixinThreadId, WeixinRawMessage> {
  readonly name = 'weixin';
  private readonly api: WeixinApiClient;
  private readonly formatConverter: WeixinFormatConverter;
  private _userName: string;
  private _botUserId?: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  /**
   * Per-thread contextToken cache.
   * WeChat requires replying with the contextToken from the latest inbound message.
   */
  private contextTokens = new Map<string, string>();

  get userName(): string {
    return this._userName;
  }

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  constructor(config: WeixinAdapterConfig & { userName?: string }) {
    this.api = new WeixinApiClient(config.appToken);
    this.formatConverter = new WeixinFormatConverter();
    this._userName = config.userName || 'weixin-bot';
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();

    try {
      const info = await this.api.getBotInfo();
      if (info.data) {
        if (info.data.nickname) this._userName = info.data.nickname;
        if (info.data.botId) this._botUserId = info.data.botId;
      }
    } catch {
      // Bot info not critical for initialization
    }

    this.logger.info('Initialized WeChat adapter (botUserId=%s)', this._botUserId);
  }

  // ------------------------------------------------------------------
  // Webhook handling — processes forwarded messages from the monitor
  // ------------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const bodyText = await request.text();

    let update: WeixinUpdate;
    try {
      update = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (!update.message) {
      return Response.json({ ok: true });
    }

    const msg = update.message;

    // Cache contextToken for replies
    const threadId = this.buildThreadId(msg);
    if (msg.contextToken) {
      this.contextTokens.set(threadId, msg.contextToken);
    }

    const messageFactory = () => this.parseRawEvent(msg, threadId);

    this.chat.processMessage(this, threadId, messageFactory, options);

    return Response.json({ ok: true });
  }

  private buildThreadId(msg: WeixinRawMessage): string {
    if (msg.groupId) {
      return this.encodeThreadId({ id: msg.groupId, type: 'group' });
    }
    return this.encodeThreadId({ id: msg.from.id, type: 'single' });
  }

  // ------------------------------------------------------------------
  // Message operations
  // ------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WeixinRawMessage>> {
    const { id } = this.decodeThreadId(threadId);
    const text = this.formatConverter.renderPostable(message);
    const contextToken = this.contextTokens.get(threadId);

    const response = await this.api.sendMessage({
      content: text,
      contextToken,
      to: id,
    });

    const msgId = response.data?.msgId || '';
    const timestamp = response.data?.timestamp || Date.now();

    return {
      id: msgId,
      raw: {
        content: text,
        from: { id: this._botUserId || '' },
        id: msgId,
        timestamp,
        to: id,
        type: 1,
      },
      threadId,
    };
  }

  async editMessage(
    threadId: string,
    _messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WeixinRawMessage>> {
    // WeChat doesn't support editing — fall back to posting a new message
    return this.postMessage(threadId, message);
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    this.logger.warn('Message deletion not supported for WeChat');
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<WeixinRawMessage>> {
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { type, id } = this.decodeThreadId(threadId);

    return {
      channelId: threadId,
      id: threadId,
      isDM: type === 'single',
      metadata: { id, type },
    };
  }

  // ------------------------------------------------------------------
  // Message parsing
  // ------------------------------------------------------------------

  parseMessage(raw: WeixinRawMessage): Message<WeixinRawMessage> {
    const formatted = parseMarkdown(raw.content || '');
    const threadId = raw.groupId
      ? this.encodeThreadId({ id: raw.groupId, type: 'group' })
      : this.encodeThreadId({ id: raw.from.id, type: 'single' });

    return new Message({
      attachments: [],
      author: {
        fullName: raw.from.nickname || raw.from.id,
        isBot: false,
        isMe: false,
        userId: raw.from.id,
        userName: raw.from.nickname || raw.from.id,
      },
      formatted,
      id: raw.id,
      metadata: {
        dateSent: new Date(raw.timestamp),
        edited: false,
      },
      raw,
      text: raw.content || '',
      threadId,
    });
  }

  private async parseRawEvent(
    msg: WeixinRawMessage,
    threadId: string,
  ): Promise<Message<WeixinRawMessage>> {
    const formatted = parseMarkdown(msg.content || '');

    const author: Author = {
      fullName: msg.from.nickname || msg.from.id,
      isBot: false,
      isMe: false,
      userId: msg.from.id,
      userName: msg.from.nickname || msg.from.id,
    };

    return new Message({
      attachments: [],
      author,
      formatted,
      id: msg.id,
      metadata: {
        dateSent: new Date(msg.timestamp),
        edited: false,
      },
      raw: msg,
      text: msg.content || '',
      threadId,
    });
  }

  // ------------------------------------------------------------------
  // Reactions & typing (not supported)
  // ------------------------------------------------------------------

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // WeChat iLink API doesn't support reactions
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // WeChat iLink API doesn't support reactions
  }

  async startTyping(_threadId: string): Promise<void> {
    // WeChat has no typing indicator API
  }

  // ------------------------------------------------------------------
  // Thread ID encoding
  // ------------------------------------------------------------------

  encodeThreadId(data: WeixinThreadId): string {
    return `weixin:${data.type}:${data.id}`;
  }

  decodeThreadId(threadId: string): WeixinThreadId {
    const parts = threadId.split(':');
    if (parts.length < 3 || parts[0] !== 'weixin') {
      return { id: threadId, type: 'single' };
    }

    const type = parts[1] as WeixinThreadId['type'];
    const id = parts[2];

    return { id, type };
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(threadId: string): boolean {
    const { type } = this.decodeThreadId(threadId);
    return type === 'single';
  }

  // ------------------------------------------------------------------
  // Format rendering
  // ------------------------------------------------------------------

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // ------------------------------------------------------------------
  // Context token management (public for platform client use)
  // ------------------------------------------------------------------

  getContextToken(threadId: string): string | undefined {
    return this.contextTokens.get(threadId);
  }

  setContextToken(threadId: string, token: string): void {
    this.contextTokens.set(threadId, token);
  }
}

/**
 * Factory function to create a WeixinAdapter.
 */
export function createWeixinAdapter(
  config: WeixinAdapterConfig & { userName?: string },
): WeixinAdapter {
  return new WeixinAdapter(config);
}
