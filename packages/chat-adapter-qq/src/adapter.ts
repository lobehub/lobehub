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
import mime from 'mime';

import { QQApiClient } from './api';
import { signWebhookResponse } from './crypto';
import { isQQActiveRateLimited, isQQDuplicateReply, isQQPassiveExpired } from './errors';
import { QQFormatConverter } from './format-converter';
import { QQGatewayConnection } from './gateway';
import {
  createMemoryQQPassiveStore,
  QQ_DEFERRED_PREFIX,
  QQ_PASSIVE_LIMITS,
  type QQPassiveSlot,
  type QQPassiveStore,
  type QQPassiveThreadType,
} from './passive';
import type {
  QQAdapterConfig,
  QQAttachment,
  QQRawMessage,
  QQThreadId,
  QQSendMessageResponse,
  QQWebhookEventData,
  QQWebhookPayload,
} from './types';
import { QQ_EVENT_TYPES, QQ_OP_CODES } from './types';

/**
 * QQ event types that only fire when the bot itself was @-mentioned.
 *
 * chat-sdk's own `detectMention()` scans `message.text` for an `@name` / `<@!id>` marker, and
 * neither survives here: QQ already strips the "@bot" prefix from a group message's content, and
 * this adapter strips whatever `<@!…>` markers remain before parsing. Without the explicit flag
 * `onNewMention` never fires, so a group @-mention is routed as ordinary channel chatter (and,
 * with no watch keyword and bot-wake off, silently dropped).
 */
const BOT_MENTION_EVENT_TYPES = new Set<string>([
  QQ_EVENT_TYPES.AT_MESSAGE_CREATE,
  QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE,
]);

export class QQAdapter implements Adapter<QQThreadId, QQRawMessage> {
  readonly name = 'qq';
  private readonly api: QQApiClient;
  private readonly appId: string;
  private readonly clientSecret: string;
  private readonly formatConverter: QQFormatConverter;
  /** Tracks each conversation's passive-reply window; see `passive.ts`. */
  private readonly passive: QQPassiveStore;
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
    this.appId = config.appId;
    this.clientSecret = config.clientSecret;
    this.formatConverter = new QQFormatConverter();
    this.passive = config.passiveStore ?? createMemoryQQPassiveStore();
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

    // Every inbound message opens (or restarts) the passive-reply window the answer prefers: a
    // passive reply costs no quota, an active one is rate limited per bot and per group. A reply
    // parked because both were unavailable goes out first, before the new message is answered.
    await this.passive.open(this.passiveKey(threadId), {
      at: Date.now(),
      eventId: payload.id,
      msgId: eventData.id,
    });
    await this.flushDeferred(threadId, this.threadTypeOf(threadId));

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

    const response = await this.sendReply(threadId, type, id, guildId, text);
    if (!response) {
      return {
        id: `qq-deferred-${Date.now()}`,
        raw: {
          author: { id: this._botUserId || '' },
          content: text,
          id: '',
          timestamp: new Date().toISOString(),
        } as QQRawMessage,
        threadId,
      };
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

  // ------------------------------------------------------------------
  // Passive reply window
  // ------------------------------------------------------------------

  private passiveKey(threadId: string): string {
    return `${this.appId}:${threadId}`;
  }

  private threadTypeOf(threadId: string): QQPassiveThreadType {
    return this.decodeThreadId(threadId).type;
  }

  /**
   * Send one reply, cheapest transport first.
   *
   * A passive reply (inside the inbound message's window) costs no quota; once the window closes
   * or its five replies are spent, QQ still accepts an active message — it is rate limited per bot
   * and per group, not forbidden — so the reply goes out uncoupled. Only when that quota is gone
   * too does the text get parked for the next inbound message.
   *
   * @returns the sent message, or undefined when the text was parked instead.
   */
  private async sendReply(
    threadId: string,
    type: QQPassiveThreadType,
    id: string,
    guildId: string | undefined,
    text: string,
  ): Promise<QQSendMessageResponse | undefined> {
    const slot = await this.reserveReplySlot(threadId, type);

    if (slot) {
      try {
        return await this.sendInThread(type, id, guildId, text, slot);
      } catch (error) {
        if (isQQDuplicateReply(error)) {
          // QQ already has this (msg_id, msg_seq): the text is in the chat, do not repeat it.
          this.logger?.warn('QQ rejected a duplicate reply in %s, keeping the first', threadId);
          return undefined;
        }
        if (!isQQPassiveExpired(error)) throw error;

        this.logger?.warn('QQ passive window refused a reply in %s, retrying as active', threadId);
      }
    }

    return this.sendAsActiveMessage(threadId, type, id, guildId, text);
  }

  /** Uncoupled send, subject to QQ's active-message frequency cap. */
  private async sendAsActiveMessage(
    threadId: string,
    type: QQPassiveThreadType,
    id: string,
    guildId: string | undefined,
    text: string,
  ): Promise<QQSendMessageResponse | undefined> {
    try {
      return await this.sendInThread(type, id, guildId, text, undefined);
    } catch (error) {
      if (!isQQActiveRateLimited(error)) throw error;

      // Bot-wide / per-group quota is exhausted right now: wait for the next inbound message,
      // which reopens a free window.
      this.logger?.warn('QQ active-message quota exhausted in %s, deferring', threadId);
      await this.deferReply(threadId, text);
      return undefined;
    }
  }

  /** One reply slot inside the conversation's window, or null when nothing may go out passively. */
  private async reserveReplySlot(
    threadId: string,
    type: QQPassiveThreadType,
  ): Promise<QQPassiveSlot | null> {
    try {
      return await this.passive.reserve(this.passiveKey(threadId), QQ_PASSIVE_LIMITS[type]);
    } catch (error) {
      this.logger?.warn('QQ passive window lookup failed for %s: %O', threadId, error);
      return null;
    }
  }

  private async sendInThread(
    type: QQPassiveThreadType,
    id: string,
    guildId: string | undefined,
    text: string,
    slot: QQPassiveSlot | undefined,
  ) {
    const options = slot && { eventId: slot.eventId, msgId: slot.msgId, msgSeq: slot.seq };

    switch (type) {
      case 'group': {
        return this.api.sendGroupMessage(id, text, options);
      }
      case 'guild': {
        return this.api.sendGuildMessage(id, text, options);
      }
      case 'c2c': {
        return this.api.sendC2CMessage(id, text, options);
      }
      case 'dms': {
        return this.api.sendDmsMessage(guildId || id, text, options);
      }
      default: {
        throw new Error(`Unknown thread type: ${type}`);
      }
    }
  }

  /** Park text the current window cannot carry, so the next inbound message delivers it. */
  private async deferReply(threadId: string, text: string): Promise<void> {
    if (!text.trim()) return;

    this.logger?.warn(
      'QQ passive window closed for %s, deferring reply (%d chars)',
      threadId,
      text.length,
    );

    try {
      await this.passive.savePending(this.passiveKey(threadId), text);
    } catch (error) {
      this.logger?.error('QQ failed to park a deferred reply for %s: %O', threadId, error);
    }
  }

  /**
   * Deliver a reply the previous window could not carry. Runs when the next inbound message opens
   * a fresh window, so the reader gets the missed answer before the new one.
   */
  private async flushDeferred(threadId: string, type: QQPassiveThreadType): Promise<void> {
    let text: string | undefined;
    try {
      text = await this.passive.takePending(this.passiveKey(threadId));
    } catch (error) {
      this.logger?.warn('QQ failed to read a deferred reply for %s: %O', threadId, error);
      return;
    }
    if (!text?.trim()) return;

    const { id, guildId } = this.decodeThreadId(threadId);
    try {
      const sent = await this.sendReply(
        threadId,
        type,
        id,
        guildId,
        `${QQ_DEFERRED_PREFIX}${text}`,
      );
      if (sent) this.logger?.info('QQ delivered a deferred reply in %s', threadId);
    } catch (error) {
      this.logger?.error('QQ failed to deliver a deferred reply in %s: %O', threadId, error);
    }
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
      // A group message can only reach the bot through GROUP_AT_MESSAGE_CREATE, so it is always a
      // mention; a guild message keeps the `<@!id>` marker in its raw content.
      isMention: !!raw.group_openid || this.contentMentionsBot(raw.content),
      metadata: {
        dateSent: new Date(raw.timestamp),
        edited: false,
      },
      raw,
      text: cleanText,
      threadId,
    });
  }

  /** Whether the raw content carries a `<@!botUserId>` marker for this bot. */
  private contentMentionsBot(content?: string): boolean {
    if (!content || !this._botUserId) return false;

    const escapedId = this._botUserId.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return new RegExp(`<@!?${escapedId}>`).test(content);
  }

  private async parseRawEvent(
    data: QQWebhookEventData,
    threadId: string,
    eventType: string,
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
      // Both AT_MESSAGE_CREATE (guild) and GROUP_AT_MESSAGE_CREATE only reach the bot when it was
      // @-mentioned — see BOT_MENTION_EVENT_TYPES. c2c / dms are DMs, which chat-sdk marks itself.
      isMention: BOT_MENTION_EVENT_TYPES.has(eventType),
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
      // QQ's `content_type` is not always a real MIME type — for c2c file
      // attachments it comes back as the coarse category label `"file"`. Trusting
      // it verbatim mislabels e.g. an `.m4a` as `"file"` instead of `audio/mp4`,
      // which then defeats the filename-based MIME recovery in ingestAttachment
      // (that only re-infers for `application/octet-stream`). Fall back to the
      // filename when content_type isn't a usable MIME type.
      const mimeType = this.resolveMimeType(a.content_type, a.filename);
      return {
        fetchData: () => this.fetchAttachmentData(a.url),
        height: a.height,
        mimeType,
        name: a.filename,
        size: a.size,
        type: this.resolveAttachmentType(mimeType),
        url: a.url,
        width: a.width,
      } as Attachment;
    });
  }

  /**
   * Resolve a usable MIME type from QQ's `content_type`, falling back to
   * filename-based inference when QQ sends a non-MIME value (e.g. `"file"`).
   */
  private resolveMimeType(contentType: string | undefined, filename?: string): string {
    if (contentType && contentType.includes('/')) return contentType;
    return (filename && mime.getType(filename)) || 'application/octet-stream';
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
