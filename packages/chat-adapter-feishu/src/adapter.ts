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

import { LarkApiClient } from './api';
import { decryptLarkEvent } from './crypto';
import { LarkFormatConverter } from './format-converter';
import type {
  LarkAdapterConfig,
  LarkMessageBody,
  LarkRawMessage,
  LarkThreadId,
  LarkWebhookPayload,
} from './types';

export class LarkAdapter implements Adapter<LarkThreadId, LarkRawMessage> {
  readonly name: string;
  private readonly api: LarkApiClient;
  private readonly encryptKey?: string;
  private readonly verificationToken?: string;
  private readonly platform: 'lark' | 'feishu';
  private readonly formatConverter: LarkFormatConverter;
  private _userName: string;
  private _botUserId?: string;
  private chat!: ChatInstance;
  private logger!: Logger;
  private static SENDER_NAME_TTL_MS = 10 * 60_000;
  private senderNameCache = new Map<string, { expireAt: number; name: string }>();
  private senderNamePermissionDenied = false;

  get userName(): string {
    return this._userName;
  }

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  constructor(config: LarkAdapterConfig & { logger?: Logger; userName?: string }) {
    this.platform = config.platform || 'lark';
    this.name = this.platform;
    this.api = new LarkApiClient(config.appId, config.appSecret, this.platform);
    this.encryptKey = config.encryptKey;
    this.verificationToken = config.verificationToken;
    this.formatConverter = new LarkFormatConverter();
    this._userName = config.userName || 'lark-bot';
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();

    // Validate credentials
    await this.api.getTenantAccessToken();

    // Try to fetch bot info for userName/botUserId
    try {
      const botInfo = await this.api.getBotInfo();
      if (botInfo) {
        if (botInfo.app_name) this._userName = botInfo.app_name;
        if (botInfo.open_id) this._botUserId = botInfo.open_id;
      }
    } catch {
      // Bot info not critical — continue
    }

    this.logger.info('Initialized %s adapter (botUserId=%s)', this.name, this._botUserId);
  }

  // ------------------------------------------------------------------
  // Webhook handling
  // ------------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const bodyText = await request.text();

    let body: LarkWebhookPayload;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Decrypt encrypted events if needed
    if (body.encrypt) {
      if (!this.encryptKey) {
        return new Response('Encrypted event but no encrypt key configured', { status: 401 });
      }
      try {
        const decrypted = decryptLarkEvent(body.encrypt, this.encryptKey);
        body = JSON.parse(decrypted);
      } catch {
        this.logger.error('Event decryption failed');
        return new Response('Decryption failed', { status: 401 });
      }
    }

    // Verify token (skip when no verification token is configured).
    // Token location varies: v2 events use header.token, url_verification uses body.token.
    if (this.verificationToken) {
      const token = body.header?.token ?? body.token;
      if (this.verificationToken !== token) {
        this.logger.error(
          'Verification token mismatch (configured=%s, received=%s)',
          '***',
          token ? '***' : '(empty)',
        );
        return new Response('Invalid verification token', { status: 401 });
      }
    }

    // URL verification challenge (after token check)
    if (body.type === 'url_verification') {
      return Response.json({ challenge: body.challenge });
    }

    // Only handle message events
    const eventType = body.header?.event_type;
    if (eventType !== 'im.message.receive_v1') {
      return Response.json({ ok: true });
    }

    const event = body.event;
    const message = event?.message;
    const sender = event?.sender;

    if (!message || !sender) {
      return Response.json({ ok: true });
    }

    // Extract text content (for text messages) or media description
    const messageType = message.message_type;
    let messageText = '';
    let hasMedia = false;

    try {
      const content = JSON.parse(message.content);
      switch (messageType) {
        case 'text': {
          messageText = content.text || '';
          break;
        }
        case 'image':
        case 'file':
        case 'audio':
        case 'media':
        case 'sticker': {
          hasMedia = true;
          break;
        }
      }
    } catch {
      // malformed content
    }

    if (!messageText.trim() && !hasMedia) {
      return Response.json({ ok: true });
    }

    // Build thread ID
    const threadId = this.encodeThreadId({
      chatId: message.chat_id,
      platform: this.platform,
    });

    // Create message lazily via factory
    const messageFactory = () => this.parseRawEvent(message, sender, threadId, messageText);

    // Delegate to Chat SDK pipeline
    this.chat.processMessage(this, threadId, messageFactory, options);

    return Response.json({ ok: true });
  }

  // ------------------------------------------------------------------
  // Message operations
  // ------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<LarkRawMessage>> {
    const { chatId } = this.decodeThreadId(threadId);
    const text = this.formatConverter.renderPostable(message);
    const { messageId, raw } = await this.api.sendMessage(chatId, text);

    return {
      id: messageId,
      raw: raw as LarkRawMessage,
      threadId,
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<LarkRawMessage>> {
    const text = this.formatConverter.renderPostable(message);
    const { raw } = await this.api.editMessage(messageId, text);

    return {
      id: messageId,
      raw: raw as LarkRawMessage,
      threadId,
    };
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await this.api.deleteMessage(messageId);
  }

  async fetchMessages(
    threadId: string,
    options?: FetchOptions,
  ): Promise<FetchResult<LarkRawMessage>> {
    const { chatId } = this.decodeThreadId(threadId);

    const result = await this.api.listMessages(chatId, {
      pageSize: options?.limit || 50,
      pageToken: options?.cursor,
    });

    const messages = result.items.map((item: any) => this.parseMessage(item));

    return {
      messages,
      nextCursor: result.hasMore ? result.pageToken : undefined,
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatId } = this.decodeThreadId(threadId);

    try {
      const info = await this.api.getChatInfo(chatId);
      return {
        channelId: threadId,
        channelName: info?.name,
        id: threadId,
        isDM: info?.chat_mode === 'p2p',
        metadata: info || {},
      };
    } catch {
      return {
        channelId: threadId,
        id: threadId,
        metadata: {},
      };
    }
  }

  // ------------------------------------------------------------------
  // Message parsing
  // ------------------------------------------------------------------

  parseMessage(raw: LarkRawMessage): Message<LarkRawMessage> {
    let text = '';
    try {
      const content = JSON.parse(raw.content);
      text = content.text || '';
    } catch {
      // malformed
    }

    // Strip @mention markers
    const cleanText = text
      .replaceAll(/@_user_\d+/g, '')
      .replaceAll('@_all', '')
      .trim();
    const formatted = parseMarkdown(cleanText);

    const threadId = this.encodeThreadId({
      chatId: raw.chat_id,
      platform: this.platform,
    });

    // parseMessage is synchronous — create lazy-loading attachments via fetchData
    const attachments = this.buildLazyAttachments(raw);

    return new Message({
      attachments,
      author: {
        fullName: 'Unknown',
        isBot: false,
        isMe: false,
        userId: 'unknown',
        userName: 'unknown',
      },
      formatted,
      id: raw.message_id,
      metadata: {
        dateSent: new Date(Number(raw.create_time)),
        edited: false,
      },
      raw,
      text: cleanText,
      threadId,
    });
  }

  /**
   * Build attachments with lazy fetchData for synchronous parseMessage.
   * Actual download happens when fetchData() is called.
   */
  private buildLazyAttachments(raw: LarkRawMessage): Attachment[] {
    const messageType = raw.message_type;
    if (messageType === 'text' || messageType === 'post') return [];

    let content: Record<string, string>;
    try {
      content = JSON.parse(raw.content);
    } catch {
      return [];
    }

    const messageId = raw.message_id;

    switch (messageType) {
      case 'image': {
        const imageKey = content.image_key;
        if (!imageKey) return [];
        return [
          {
            fetchData: () => this.api.downloadResource(messageId, imageKey, 'image'),
            mimeType: 'image/jpeg',
            name: 'image.jpg',
            type: 'image',
          } as Attachment,
        ];
      }
      case 'file': {
        const fileKey = content.file_key;
        if (!fileKey) return [];
        return [
          {
            fetchData: () => this.api.downloadResource(messageId, fileKey, 'file'),
            mimeType: 'application/octet-stream',
            name: content.file_name || 'file',
            type: 'file',
          } as Attachment,
        ];
      }
      case 'audio': {
        const fileKey = content.file_key;
        if (!fileKey) return [];
        return [
          {
            fetchData: () => this.api.downloadResource(messageId, fileKey, 'file'),
            mimeType: 'audio/ogg',
            name: 'audio.ogg',
            type: 'audio',
          } as Attachment,
        ];
      }
      case 'media': {
        const fileKey = content.file_key;
        if (!fileKey) return [];
        return [
          {
            fetchData: () => this.api.downloadResource(messageId, fileKey, 'file'),
            mimeType: 'video/mp4',
            name: 'video.mp4',
            type: 'video',
          } as Attachment,
        ];
      }
      case 'sticker': {
        const fileKey = content.file_key;
        if (!fileKey) return [];
        return [
          {
            fetchData: () => this.api.downloadResource(messageId, fileKey, 'image'),
            mimeType: 'image/png',
            name: 'sticker.png',
            type: 'image',
          } as Attachment,
        ];
      }
      default: {
        return [];
      }
    }
  }

  // ------------------------------------------------------------------
  // Reactions
  // ------------------------------------------------------------------

  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    const emojiType = this.toEmojiType(emoji);
    try {
      await this.api.addReaction(messageId, emojiType);
    } catch {
      // Reactions may not be supported in all chat types
    }
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // Lark's remove reaction requires a reaction ID, which we don't track.
    // No-op for now.
  }

  // ------------------------------------------------------------------
  // Typing
  // ------------------------------------------------------------------

  async startTyping(_threadId: string): Promise<void> {
    // Lark has no typing indicator API for bots
  }

  // ------------------------------------------------------------------
  // Thread ID encoding
  // ------------------------------------------------------------------

  encodeThreadId(data: LarkThreadId): string {
    return `${data.platform}:${data.chatId}`;
  }

  decodeThreadId(threadId: string): LarkThreadId {
    const colonIdx = threadId.indexOf(':');
    if (colonIdx === -1) {
      return { chatId: threadId, platform: this.platform };
    }
    const prefix = threadId.slice(0, colonIdx);
    const chatId = threadId.slice(colonIdx + 1);

    const platform = prefix === 'lark' || prefix === 'feishu' ? prefix : this.platform;
    return { chatId, platform };
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(threadId: string): boolean {
    // Can't determine from threadId alone; default false
    return false;
  }

  // ------------------------------------------------------------------
  // Format rendering
  // ------------------------------------------------------------------

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private async parseRawEvent(
    message: LarkMessageBody,
    sender: { sender_id: { open_id: string }; sender_type: string },
    threadId: string,
    messageText: string,
  ): Promise<Message<LarkRawMessage>> {
    const cleanText = messageText
      .replaceAll(/@_user_\d+/g, '')
      .replaceAll('@_all', '')
      .trim();
    const formatted = parseMarkdown(cleanText);

    const openId = sender.sender_id.open_id;
    const isBot = sender.sender_type === 'bot';

    // Resolve user display name via contact API (cached, graceful degradation)
    const displayName = (await this.resolveSenderName(openId)) || openId;

    const author: Author = {
      fullName: displayName,
      isBot,
      isMe: isBot && openId === this._botUserId,
      userId: openId,
      userName: displayName,
    };

    // Download media attachments for non-text messages
    const attachments = await this.downloadMediaAttachments(message);

    return new Message({
      attachments,
      author,
      formatted,
      id: message.message_id,
      metadata: {
        dateSent: new Date(Number(message.create_time)),
        edited: false,
      },
      raw: message,
      text: cleanText,
      threadId,
    });
  }

  /**
   * Download media attachments from a Feishu/Lark message.
   *
   * Supported message types: image, file, audio, media (video), sticker.
   * Uses the Lark resource download API to fetch binary data.
   */
  private async downloadMediaAttachments(message: LarkMessageBody): Promise<Attachment[]> {
    const messageType = message.message_type;
    if (messageType === 'text' || messageType === 'post') return [];

    let content: Record<string, string>;
    try {
      content = JSON.parse(message.content);
    } catch {
      return [];
    }

    const attachments: Attachment[] = [];
    const messageId = message.message_id;

    try {
      switch (messageType) {
        case 'image': {
          const imageKey = content.image_key;
          if (!imageKey) break;
          const buffer = await this.api.downloadResource(messageId, imageKey, 'image');
          attachments.push({
            buffer,
            mimeType: 'image/jpeg',
            name: 'image.jpg',
            type: 'image',
          } as Attachment);
          break;
        }
        case 'file': {
          const fileKey = content.file_key;
          const fileName = content.file_name;
          if (!fileKey) break;
          const buffer = await this.api.downloadResource(messageId, fileKey, 'file');
          attachments.push({
            buffer,
            mimeType: 'application/octet-stream',
            name: fileName || 'file',
            type: 'file',
          } as Attachment);
          break;
        }
        case 'audio': {
          const fileKey = content.file_key;
          if (!fileKey) break;
          const buffer = await this.api.downloadResource(messageId, fileKey, 'file');
          attachments.push({
            buffer,
            mimeType: 'audio/ogg',
            name: 'audio.ogg',
            type: 'audio',
          } as Attachment);
          break;
        }
        case 'media': {
          // Video: has file_key (video) and image_key (thumbnail)
          const fileKey = content.file_key;
          if (!fileKey) break;
          const buffer = await this.api.downloadResource(messageId, fileKey, 'file');
          attachments.push({
            buffer,
            mimeType: 'video/mp4',
            name: 'video.mp4',
            type: 'video',
          } as Attachment);
          break;
        }
        case 'sticker': {
          const fileKey = content.file_key;
          if (!fileKey) break;
          const buffer = await this.api.downloadResource(messageId, fileKey, 'image');
          attachments.push({
            buffer,
            mimeType: 'image/png',
            name: 'sticker.png',
            type: 'image',
          } as Attachment);
          break;
        }
      }
    } catch (error) {
      this.logger.warn(
        'Failed to download %s media for message %s: %s',
        messageType,
        messageId,
        error,
      );
    }

    return attachments;
  }

  private async resolveSenderName(openId: string): Promise<string | undefined> {
    // Skip API calls if we already know permission is denied
    if (this.senderNamePermissionDenied) return undefined;

    const now = Date.now();
    const cached = this.senderNameCache.get(openId);
    if (cached && cached.expireAt > now) return cached.name;

    try {
      const info = await this.api.getUserInfo(openId);
      if (info?.name) {
        this.senderNameCache.set(openId, {
          expireAt: now + LarkAdapter.SENDER_NAME_TTL_MS,
          name: info.name,
        });
        return info.name;
      }
      return undefined;
    } catch (err) {
      const msg = String(err);
      // Mark permission denied to avoid repeated failing calls
      if (msg.includes('99991672') || msg.includes('Access denied')) {
        this.senderNamePermissionDenied = true;
        console.warn('[adapter-lark] sender name resolution disabled: missing contact permission');
      }
      return undefined;
    }
  }

  private toEmojiType(emoji: EmojiValue | string): string {
    if (typeof emoji === 'string') return emoji;
    // EmojiValue is a symbol-like; use its string form
    return String(emoji);
  }
}

/**
 * Factory function to create a LarkAdapter.
 */
export function createLarkAdapter(
  config: LarkAdapterConfig & { logger?: Logger; userName?: string },
): LarkAdapter {
  return new LarkAdapter(config);
}
