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

import { WechatApiClient } from './api';
import { WechatFormatConverter } from './format-converter';
import type { WechatAdapterConfig, WechatRawMessage, WechatThreadId, WechatUpdate } from './types';

/**
 * WeChat (iLink) adapter for Chat SDK.
 *
 * Handles webhook requests forwarded by the long-polling monitor
 * and message operations via iLink Bot API.
 */
export class WechatAdapter implements Adapter<WechatThreadId, WechatRawMessage> {
  readonly name = 'wechat';
  private readonly api: WechatApiClient;
  private readonly formatConverter: WechatFormatConverter;
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

  constructor(config: WechatAdapterConfig & { userName?: string }) {
    this.api = new WechatApiClient(config.appToken);
    this.formatConverter = new WechatFormatConverter();
    this._userName = config.userName || 'wechat-bot';
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

    let update: WechatUpdate;
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

  private buildThreadId(msg: WechatRawMessage): string {
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
  ): Promise<RawMessage<WechatRawMessage>> {
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
  ): Promise<RawMessage<WechatRawMessage>> {
    // WeChat doesn't support editing — fall back to posting a new message
    return this.postMessage(threadId, message);
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    this.logger.warn('Message deletion not supported for WeChat');
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<WechatRawMessage>> {
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

  parseMessage(raw: WechatRawMessage): Message<WechatRawMessage> {
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
    msg: WechatRawMessage,
    threadId: string,
  ): Promise<Message<WechatRawMessage>> {
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

  encodeThreadId(data: WechatThreadId): string {
    return `wechat:${data.type}:${data.id}`;
  }

  decodeThreadId(threadId: string): WechatThreadId {
    const parts = threadId.split(':');
    if (parts.length < 3 || parts[0] !== 'wechat') {
      return { id: threadId, type: 'single' };
    }

    const type = parts[1] as WechatThreadId['type'];
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
 * Factory function to create a WechatAdapter.
 */
export function createWechatAdapter(
  config: WechatAdapterConfig & { userName?: string },
): WechatAdapter {
  return new WechatAdapter(config);
}
