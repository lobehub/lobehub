import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
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

import { QQApiClient } from './api';
import { signWebhookResponse } from './crypto';
import { QQFormatConverter } from './format-converter';
import { QQGatewayConnection } from './gateway';
import type {
  QQAdapterConfig,
  QQAttachment,
  QQRawMessage,
  QQThreadId,
  QQWebhookEventData,
  QQWebhookPayload,
} from './types';
import { QQ_EVENT_TYPES, QQ_OP_CODES } from './types';

export class QQAdapter implements Adapter<QQThreadId, QQRawMessage> {
  readonly name = 'qq';
  private readonly api: QQApiClient;
  private readonly clientSecret: string;
  private readonly formatConverter: QQFormatConverter;
  private _userName: string;
  private _botUserId?: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  get userName(): string {
    return this._userName;
  }

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  constructor(config: QQAdapterConfig & { userName?: string }) {
    this.api = new QQApiClient(config.appId, config.clientSecret);
    this.clientSecret = config.clientSecret;
    this.formatConverter = new QQFormatConverter();
    this._userName = config.userName || 'qq-bot';
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();

    // Validate credentials by getting access token
    await this.api.getAccessToken();

    // Try to fetch bot info
    try {
      const botInfo = await this.api.getBotInfo();
      if (botInfo) {
        if (botInfo.username) this._userName = botInfo.username;
        if (botInfo.id) this._botUserId = botInfo.id;
      }
    } catch {
      // Bot info not critical
    }

    this.logger.info('Initialized QQ adapter (botUserId=%s)', this._botUserId);
  }

  // ------------------------------------------------------------------
  // Webhook handling
  // ------------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const bodyText = await request.text();

    let payload: QQWebhookPayload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Handle webhook verification (op: 13)
    if (payload.op === QQ_OP_CODES.VERIFY) {
      const verifyData = payload.d as { event_ts: string; plain_token: string };
      if (verifyData.plain_token && verifyData.event_ts) {
        const signature = signWebhookResponse(
          verifyData.event_ts,
          verifyData.plain_token,
          this.clientSecret,
        );
        return Response.json({
          plain_token: verifyData.plain_token,
          signature,
        });
      }
      return new Response('Missing verification data', { status: 400 });
    }

    // Handle dispatch events (op: 0)
    if (payload.op !== QQ_OP_CODES.DISPATCH) {
      return Response.json({ ok: true });
    }

    const eventType = payload.t;
    const eventData = payload.d;

    // Only handle message events
    if (!this.isMessageEvent(eventType)) {
      return Response.json({ ok: true });
    }

    // Extract message content — allow through if there are attachments
    const content = eventData.content;
    const hasAttachments = eventData.attachments && eventData.attachments.length > 0;
    if (!content?.trim() && !hasAttachments) {
      return Response.json({ ok: true });
    }

    // Build thread ID based on event type
    const threadId = this.buildThreadId(eventType, eventData);
    if (!threadId) {
      return Response.json({ ok: true });
    }

    // Create message via factory
    const messageFactory = () => this.parseRawEvent(eventData, threadId, eventType!);

    // Delegate to Chat SDK pipeline
    this.chat.processMessage(this, threadId, messageFactory, options);

    return Response.json({ ok: true });
  }

  private isMessageEvent(eventType?: string): boolean {
    if (!eventType) return false;
    return (
      eventType === QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE ||
      eventType === QQ_EVENT_TYPES.C2C_MESSAGE_CREATE ||
      eventType === QQ_EVENT_TYPES.AT_MESSAGE_CREATE ||
      eventType === QQ_EVENT_TYPES.DIRECT_MESSAGE_CREATE
    );
  }

  private buildThreadId(eventType: string | undefined, data: QQWebhookEventData): string | null {
    if (!eventType) return null;

    switch (eventType) {
      case QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE: {
        if (!data.group_openid) return null;
        return this.encodeThreadId({ id: data.group_openid, type: 'group' });
      }
      case QQ_EVENT_TYPES.C2C_MESSAGE_CREATE: {
        if (!data.author?.id) return null;
        return this.encodeThreadId({ id: data.author.id, type: 'c2c' });
      }
      case QQ_EVENT_TYPES.AT_MESSAGE_CREATE: {
        if (!data.channel_id) return null;
        return this.encodeThreadId({
          guildId: data.guild_id,
          id: data.channel_id,
          type: 'guild',
        });
      }
      case QQ_EVENT_TYPES.DIRECT_MESSAGE_CREATE: {
        if (!data.guild_id) return null;
        return this.encodeThreadId({ id: data.guild_id, type: 'dms' });
      }
      default: {
        return null;
      }
    }
  }

  // ------------------------------------------------------------------
  // Gateway listener (WebSocket mode)
  // ------------------------------------------------------------------

  /**
   * Start a persistent WebSocket gateway connection.
   * Dispatch events are forwarded to the webhookUrl as HTTP POSTs,
   * preserving compatibility with the existing handleWebhook() pipeline.
   */
  async startGatewayListener(
    options: { waitUntil: (task: Promise<any>) => void },
    durationMs: number,
    abortSignal: AbortSignal,
    webhookUrl: string,
  ): Promise<void> {
    const gateway = new QQGatewayConnection(this.api, {
      abortSignal,
      durationMs,
      log: (msg: string, ...rest: any[]) => this.logger.info(msg, ...rest),
      webhookUrl,
    });

    const gatewayTask = gateway.connect();
    options.waitUntil(gatewayTask);
    await gatewayTask;
  }

  // ------------------------------------------------------------------
  // Message operations
  // ------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<QQRawMessage>> {
    const { type, id, guildId } = this.decodeThreadId(threadId);
    const text = this.formatConverter.renderPostable(message);

    let response;
    switch (type) {
      case 'group': {
        response = await this.api.sendGroupMessage(id, text);
        break;
      }
      case 'guild': {
        response = await this.api.sendGuildMessage(id, text);
        break;
      }
      case 'c2c': {
        response = await this.api.sendC2CMessage(id, text);
        break;
      }
      case 'dms': {
        response = await this.api.sendDmsMessage(guildId || id, text);
        break;
      }
      default: {
        throw new Error(`Unknown thread type: ${type}`);
      }
    }

    return {
      id: response.id,
      raw: {
        author: { id: this._botUserId || '' },
        content: text,
        id: response.id,
        timestamp: response.timestamp,
      } as QQRawMessage,
      threadId,
    };
  }

  async editMessage(
    threadId: string,
    _messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<QQRawMessage>> {
    // QQ doesn't support editing — fall back to posting a new message
    return this.postMessage(threadId, message);
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    // TODO: Implement message recall if QQ API supports it
    this.logger.warn('Message deletion not implemented for QQ');
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<QQRawMessage>> {
    // QQ doesn't provide message history API for bots
    return {
      messages: [],
      nextCursor: undefined,
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { type, id } = this.decodeThreadId(threadId);

    return {
      channelId: threadId,
      id: threadId,
      isDM: type === 'c2c' || type === 'dms',
      metadata: { id, type },
    };
  }

  // ------------------------------------------------------------------
  // Message parsing
  // ------------------------------------------------------------------

  parseMessage(raw: QQRawMessage): Message<QQRawMessage> {
    const cleanText = this.formatConverter.cleanMentions(raw.content || '');
    const formatted = parseMarkdown(cleanText);

    let threadId: string;
    if (raw.group_openid) {
      threadId = this.encodeThreadId({ id: raw.group_openid, type: 'group' });
    } else if (raw.channel_id) {
      threadId = this.encodeThreadId({
        guildId: raw.guild_id,
        id: raw.channel_id,
        type: 'guild',
      });
    } else {
      threadId = this.encodeThreadId({ id: raw.author.id, type: 'c2c' });
    }

    const attachments = this.mapQQAttachments(raw.attachments);

    return new Message({
      attachments,
      author: {
        fullName: 'Unknown',
        isBot: false,
        isMe: false,
        userId: raw.author.id,
        userName: 'unknown',
      },
      formatted,
      id: raw.id,
      metadata: {
        dateSent: new Date(raw.timestamp),
        edited: false,
      },
      raw,
      text: cleanText,
      threadId,
    });
  }

  private async parseRawEvent(
    data: QQWebhookEventData,
    threadId: string,
    _eventType: string,
  ): Promise<Message<QQRawMessage>> {
    const content = data.content || '';
    const cleanText = this.formatConverter.cleanMentions(content);
    const formatted = parseMarkdown(cleanText);

    const authorId = data.author?.id || 'unknown';
    const isBot = false; // Webhook events are from users

    const author: Author = {
      fullName: authorId,
      isBot,
      isMe: isBot && authorId === this._botUserId,
      userId: authorId,
      userName: authorId,
    };

    const raw: QQRawMessage = {
      attachments: data.attachments,
      author: data.author || { id: 'unknown' },
      channel_id: data.channel_id,
      content,
      group_openid: data.group_openid,
      guild_id: data.guild_id,
      id: data.id || '',
      timestamp: data.timestamp || new Date().toISOString(),
    };

    const attachments = this.mapQQAttachments(data.attachments);

    return new Message({
      attachments,
      author,
      formatted,
      id: data.id || '',
      metadata: {
        dateSent: new Date(data.timestamp || Date.now()),
        edited: false,
      },
      raw,
      text: cleanText,
      threadId,
    });
  }

  // ------------------------------------------------------------------
  // Attachment mapping
  // ------------------------------------------------------------------

  /**
   * Map QQ attachments to Chat SDK Attachment objects.
   * QQ provides direct URLs for media files.
   */
  private mapQQAttachments(qqAttachments?: QQAttachment[]): Attachment[] {
    if (!qqAttachments || qqAttachments.length === 0) return [];

    return qqAttachments.map((a) => {
      const type = this.resolveAttachmentType(a.content_type);
      return {
        fetchData: () => this.fetchAttachmentData(a.url),
        height: a.height,
        mimeType: a.content_type,
        name: a.filename,
        size: a.size,
        type,
        url: a.url,
        width: a.width,
      } as Attachment;
    });
  }

  private resolveAttachmentType(contentType: string): 'image' | 'video' | 'audio' | 'file' {
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType.startsWith('audio/')) return 'audio';
    return 'file';
  }

  private async fetchAttachmentData(url: string): Promise<Buffer> {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Failed to fetch QQ attachment: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  // ------------------------------------------------------------------
  // Reactions (not supported by QQ Bot API)
  // ------------------------------------------------------------------

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // QQ Bot API doesn't support reactions
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // QQ Bot API doesn't support reactions
  }

  // ------------------------------------------------------------------
  // Typing (not supported by QQ Bot API)
  // ------------------------------------------------------------------

  async startTyping(_threadId: string): Promise<void> {
    // QQ has no typing indicator API for bots
  }

  // ------------------------------------------------------------------
  // Thread ID encoding
  // ------------------------------------------------------------------

  encodeThreadId(data: QQThreadId): string {
    if (data.guildId) {
      return `qq:${data.type}:${data.id}:${data.guildId}`;
    }
    return `qq:${data.type}:${data.id}`;
  }

  decodeThreadId(threadId: string): QQThreadId {
    const parts = threadId.split(':');
    if (parts.length < 3 || parts[0] !== 'qq') {
      // Fallback for malformed thread IDs
      return { id: threadId, type: 'group' };
    }

    const type = parts[1] as QQThreadId['type'];
    const id = parts[2];
    const guildId = parts[3];

    return { guildId, id, type };
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(threadId: string): boolean {
    const { type } = this.decodeThreadId(threadId);
    return type === 'c2c' || type === 'dms';
  }

  // ------------------------------------------------------------------
  // Format rendering
  // ------------------------------------------------------------------

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

/**
 * Factory function to create a QQAdapter.
 */
export function createQQAdapter(config: QQAdapterConfig & { userName?: string }): QQAdapter {
  return new QQAdapter(config);
}
