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

import { WechatApiClient } from './api';
import { WechatFormatConverter } from './format-converter';
import type { WechatAdapterConfig, WechatRawMessage, WechatThreadId } from './types';
import { MessageItemType, MessageState, MessageType } from './types';

/**
 * Extract text content from a WechatRawMessage's item_list.
 */
function extractText(msg: WechatRawMessage): string {
  const parts: string[] = [];
  for (const item of msg.item_list) {
    switch (item.type) {
      case MessageItemType.TEXT: {
        if (item.text_item?.text) parts.push(item.text_item.text);
        break;
      }
      case MessageItemType.IMAGE: {
        // Image content is conveyed via attachments, no text placeholder needed
        break;
      }
      case MessageItemType.VOICE: {
        // Only include transcription text, skip placeholder
        if (item.voice_item?.text) parts.push(item.voice_item.text);
        break;
      }
      case MessageItemType.FILE: {
        parts.push(`[file: ${item.file_item?.file_name || 'unknown'}]`);
        break;
      }
      case MessageItemType.VIDEO: {
        // Video content is conveyed via attachments, no text placeholder needed
        break;
      }
    }
  }
  return parts.join('\n');
}

function parseOptionalNumber(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Check whether a message item carries CDN media that can be downloaded.
 */
function hasCdnMedia(item: WechatRawMessage['item_list'][number]): boolean {
  switch (item.type) {
    case MessageItemType.IMAGE: {
      return !!item.image_item?.media?.encrypt_query_param;
    }
    case MessageItemType.FILE: {
      return !!item.file_item?.media?.encrypt_query_param;
    }
    case MessageItemType.VOICE: {
      return !!item.voice_item?.media?.encrypt_query_param;
    }
    case MessageItemType.VIDEO: {
      return !!item.video_item?.media?.encrypt_query_param;
    }
    default: {
      return false;
    }
  }
}

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
   * WeChat requires echoing the context_token from the latest inbound message.
   */
  private contextTokens = new Map<string, string>();

  get userName(): string {
    return this._userName;
  }

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  constructor(config: WechatAdapterConfig & { userName?: string }) {
    this.api = new WechatApiClient(config.botToken, config.botId);
    this.formatConverter = new WechatFormatConverter();
    this._userName = config.userName || 'wechat-bot';
    this._botUserId = config.botId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();

    this.logger.info('Initialized WeChat adapter (botUserId=%s)', this._botUserId);
  }

  // ------------------------------------------------------------------
  // Webhook handling — processes forwarded messages from the monitor
  // ------------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const bodyText = await request.text();

    let msg: WechatRawMessage;
    try {
      msg = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Skip bot's own messages and non-finished messages
    if (msg.message_type === MessageType.BOT) {
      return Response.json({ ok: true });
    }
    if (msg.message_state !== undefined && msg.message_state !== MessageState.FINISH) {
      return Response.json({ ok: true });
    }

    const text = extractText(msg);
    const hasMedia = msg.item_list.some(
      (item) =>
        item.type === MessageItemType.IMAGE ||
        item.type === MessageItemType.VIDEO ||
        item.type === MessageItemType.VOICE ||
        item.type === MessageItemType.FILE,
    );
    if (!text.trim() && !hasMedia) {
      return Response.json({ ok: true });
    }

    // Build thread ID and cache context token
    const threadId = this.encodeThreadId({ id: msg.from_user_id, type: 'single' });
    this.contextTokens.set(threadId, msg.context_token);

    const messageFactory = () => this.parseRawEvent(msg, threadId, text);
    this.chat.processMessage(this, threadId, messageFactory, options);

    return Response.json({ ok: true });
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
    const contextToken = this.contextTokens.get(threadId) || '';

    await this.api.sendMessage(id, text, contextToken);

    return {
      id: `bot_${Date.now()}`,
      raw: {
        client_id: `lobehub_${Date.now()}`,
        context_token: contextToken,
        create_time_ms: Date.now(),
        from_user_id: this._botUserId || '',
        item_list: [{ text_item: { text }, type: MessageItemType.TEXT }],
        message_id: 0,
        message_state: MessageState.FINISH,
        message_type: MessageType.BOT,
        to_user_id: id,
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
    const text = extractText(raw);
    const formatted = parseMarkdown(text);
    const threadId = this.encodeThreadId({ id: raw.from_user_id, type: 'single' });

    // parseMessage is synchronous — CDN download happens in parseRawEvent instead.
    return new Message({
      attachments: [],
      author: {
        fullName: raw.from_user_id,
        isBot: raw.message_type === MessageType.BOT,
        isMe: raw.message_type === MessageType.BOT,
        userId: raw.from_user_id,
        userName: raw.from_user_id,
      },
      formatted,
      id: String(raw.message_id || 0),
      metadata: {
        dateSent: new Date(raw.create_time_ms || Date.now()),
        edited: false,
      },
      raw,
      text,
      threadId,
    });
  }

  private async parseRawEvent(
    msg: WechatRawMessage,
    threadId: string,
    text: string,
  ): Promise<Message<WechatRawMessage>> {
    const formatted = parseMarkdown(text);

    // Download and decrypt media from WeChat CDN (protocol-spec §8.3).
    const attachments = await this.downloadMediaAttachments(msg);

    const author: Author = {
      fullName: msg.from_user_id,
      isBot: false,
      isMe: false,
      userId: msg.from_user_id,
      userName: msg.from_user_id,
    };

    return new Message({
      attachments,
      author,
      formatted,
      id: String(msg.message_id || 0),
      metadata: {
        dateSent: new Date(msg.create_time_ms || Date.now()),
        edited: false,
      },
      raw: msg,
      text,
      threadId,
    });
  }

  /**
   * Download media items and return attachments.
   *
   * Strategy per item type:
   *   1. If CDN media is available, download + AES decrypt (protocol-spec §8.3).
   *   2. For images: fall back to `image_item.url` if CDN is unavailable or fails.
   *
   * When uploadMedia is configured, files are uploaded directly to S3 and the
   * attachment carries a `fileId` so execAgent can skip re-uploading.
   */
  private async downloadMediaAttachments(msg: WechatRawMessage): Promise<Attachment[]> {
    const attachments: Attachment[] = [];

    for (const item of msg.item_list) {
      try {
        switch (item.type) {
          case MessageItemType.IMAGE: {
            const attachment = await this.downloadImageItem(item);
            if (attachment) attachments.push(attachment);
            break;
          }
          case MessageItemType.VOICE: {
            if (!hasCdnMedia(item) || !item.voice_item?.media) break;
            const voiceBuf = await this.api.downloadCdnMedia(item.voice_item.media);
            const voice = this.normalizeMedia(voiceBuf, 'audio/silk');
            attachments.push({
              buffer: voice.buffer,
              mimeType: voice.mimeType,
              type: 'audio',
              url: voice.url,
            } as Attachment);
            break;
          }
          case MessageItemType.FILE: {
            if (!hasCdnMedia(item) || !item.file_item?.media) break;
            const fileBuf = await this.api.downloadCdnMedia(item.file_item.media);
            const fileName = item.file_item?.file_name;
            const fileMimeType = (fileName && mime.getType(fileName)) || 'application/octet-stream';
            const file = this.normalizeMedia(fileBuf, fileMimeType);
            attachments.push({
              buffer: file.buffer,
              mimeType: file.mimeType,
              name: fileName,
              size: parseOptionalNumber(item.file_item?.len),
              type: 'file',
              url: file.url,
            } as Attachment);
            break;
          }
          case MessageItemType.VIDEO: {
            if (!hasCdnMedia(item) || !item.video_item?.media) break;
            const videoBuf = await this.api.downloadCdnMedia(item.video_item.media);
            const video = this.normalizeMedia(videoBuf, 'video/mp4');
            attachments.push({
              buffer: video.buffer,
              mimeType: video.mimeType,
              size: parseOptionalNumber(item.video_item?.video_size),
              type: 'video',
              url: video.url,
            } as Attachment);
            break;
          }
        }
      } catch (error) {
        this.logger.warn(
          'Failed to download %s media from CDN: %s',
          MessageItemType[item.type],
          error,
        );
      }
    }

    return attachments;
  }

  /**
   * Download an image item with cascading fallback:
   *   1. CDN main media (image_item.media)
   *   2. CDN thumbnail (image_item.thumb_media)
   *   3. Direct URL (image_item.url)
   */
  private async downloadImageItem(
    item: WechatRawMessage['item_list'][number],
  ): Promise<Attachment | undefined> {
    const imageItem = item.image_item;
    if (!imageItem) return undefined;

    // 1. Try CDN download from main media
    if (imageItem.media?.encrypt_query_param) {
      try {
        const buf = await this.api.downloadCdnMedia(imageItem.media, imageItem.aeskey);
        const img = this.normalizeMedia(buf, 'image/jpeg');
        return {
          buffer: img.buffer,
          mimeType: img.mimeType,
          name: 'image.jpg',
          type: 'image',
          url: img.url,
        } as Attachment;
      } catch (error) {
        this.logger.warn('CDN image download failed: %s', error);
      }
    }

    // 2. Try CDN thumbnail as fallback
    if (imageItem.thumb_media?.encrypt_query_param) {
      try {
        const buf = await this.api.downloadCdnMedia(imageItem.thumb_media, imageItem.aeskey);
        const img = this.normalizeMedia(buf, 'image/jpeg');
        return {
          buffer: img.buffer,
          mimeType: img.mimeType,
          name: 'image.jpg',
          type: 'image',
          url: img.url,
        } as Attachment;
      } catch (error) {
        this.logger.warn('CDN thumbnail download failed: %s', error);
      }
    }

    // 3. Fall back to direct url field
    if (imageItem.url) {
      try {
        const response = await fetch(imageItem.url, {
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          const buf = Buffer.from(await response.arrayBuffer());
          const contentType = response.headers.get('content-type') || 'image/jpeg';
          const img = this.normalizeMedia(buf, contentType);
          return {
            buffer: img.buffer,
            mimeType: img.mimeType,
            name: 'image.jpg',
            type: 'image',
            url: img.url,
          } as Attachment;
        }
        this.logger.warn('Image url fallback failed: HTTP %d', response.status);
      } catch (error) {
        this.logger.warn('Image url fallback failed: %s', error);
      }
    }

    this.logger.warn('No image source available (no CDN media, no thumb, no url)');
    return undefined;
  }

  /**
   * Wrap raw buffer into the shape expected by attachment objects.
   * Server-side ingestAttachment handles compression, upload, and record creation.
   */
  private normalizeMedia(
    buffer: Buffer,
    mimeType: string,
  ): { buffer: Buffer; mimeType: string; url: string } {
    return { buffer, mimeType, url: '' };
  }

  // ------------------------------------------------------------------
  // Reactions & typing (limited support)
  // ------------------------------------------------------------------

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {}

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {}

  async startTyping(threadId: string): Promise<void> {
    const { id } = this.decodeThreadId(threadId);
    const contextToken = this.contextTokens.get(threadId);
    if (!contextToken) return;
    await this.api.startTyping(id, contextToken);
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
    return { id: parts.slice(2).join(':'), type: parts[1] as WechatThreadId['type'] };
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
