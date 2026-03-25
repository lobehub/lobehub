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
        parts.push('[image]');
        break;
      }
      case MessageItemType.VOICE: {
        parts.push(item.voice_item?.text || '[voice]');
        break;
      }
      case MessageItemType.FILE: {
        parts.push(`[file: ${item.file_item?.file_name || 'unknown'}]`);
        break;
      }
      case MessageItemType.VIDEO: {
        parts.push('[video]');
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
    if (!text.trim()) {
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
   * Download CDN media items and return attachments with data URLs.
   * Per protocol-spec §8.3: GET CDN /download → AES-128-ECB decrypt.
   */
  private async downloadMediaAttachments(msg: WechatRawMessage): Promise<Attachment[]> {
    const attachments: Attachment[] = [];

    for (const item of msg.item_list) {
      if (!hasCdnMedia(item)) continue;

      try {
        switch (item.type) {
          case MessageItemType.IMAGE: {
            const media = item.image_item!.media;
            const buffer = await this.api.downloadCdnMedia(media, item.image_item!.aeskey);
            attachments.push({
              mimeType: 'image/jpeg',
              name: 'image.jpg',
              type: 'image',
              url: `data:image/jpeg;base64,${buffer.toString('base64')}`,
            });
            break;
          }
          case MessageItemType.VOICE: {
            const media = item.voice_item!.media;
            const buffer = await this.api.downloadCdnMedia(media);
            attachments.push({
              mimeType: 'audio/silk',
              type: 'audio',
              url: `data:audio/silk;base64,${buffer.toString('base64')}`,
            });
            break;
          }
          case MessageItemType.FILE: {
            const media = item.file_item!.media;
            const buffer = await this.api.downloadCdnMedia(media);
            attachments.push({
              mimeType: 'application/octet-stream',
              name: item.file_item?.file_name,
              size: parseOptionalNumber(item.file_item?.len),
              type: 'file',
              url: `data:application/octet-stream;base64,${buffer.toString('base64')}`,
            });
            break;
          }
          case MessageItemType.VIDEO: {
            const media = item.video_item!.media;
            const buffer = await this.api.downloadCdnMedia(media);
            attachments.push({
              mimeType: 'video/mp4',
              size: parseOptionalNumber(item.video_item?.video_size),
              type: 'video',
              url: `data:video/mp4;base64,${buffer.toString('base64')}`,
            });
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
