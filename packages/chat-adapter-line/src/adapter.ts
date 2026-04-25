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

import { LineApiClient, verifySignature } from './api';
import { LineFormatConverter } from './format-converter';
import type {
  LineAdapterConfig,
  LineMessage,
  LineMessageEvent,
  LineSource,
  LineThreadId,
  LineWebhookPayload,
} from './types';

/**
 * Pull user-visible text from an inbound message. We surface placeholders
 * for non-text payloads so the LLM still has something to react to (and
 * a sticker's `text`/keywords stand in as a hint of intent).
 */
function extractText(message: LineMessage): string {
  switch (message.type) {
    case 'text': {
      return message.text ?? '';
    }
    case 'sticker': {
      // LINE returns either an explicit `text` for branded stickers or a
      // keyword list — fall through `text` first, then keywords.
      if (message.text) return message.text;
      if (message.keywords?.length) return `[sticker: ${message.keywords.join(', ')}]`;
      return '[sticker]';
    }
    case 'location': {
      const parts = [message.title, message.address].filter(Boolean);
      return parts.length > 0 ? `[location: ${parts.join(', ')}]` : '[location]';
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'file': {
      // Captions are not part of LINE message payloads — surface a marker
      // so the model knows the user attached something.
      const fileName = (message as { fileName?: string }).fileName;
      return fileName ? `[${message.type}: ${fileName}]` : '';
    }
    default: {
      return '';
    }
  }
}

function chatAttachmentType(type: 'audio' | 'file' | 'image' | 'video'): string {
  switch (type) {
    case 'image': {
      return 'image';
    }
    case 'video': {
      return 'video';
    }
    case 'audio': {
      return 'audio';
    }
    case 'file':
    default: {
      return 'file';
    }
  }
}

function defaultMimeForType(type: string | undefined): string {
  switch (type) {
    case 'image': {
      return 'image/jpeg';
    }
    case 'video': {
      return 'video/mp4';
    }
    case 'audio': {
      return 'audio/m4a';
    }
    default: {
      return 'application/octet-stream';
    }
  }
}

function defaultNameForType(type: string | undefined, fileName?: string): string {
  if (fileName) return fileName;
  switch (type) {
    case 'image': {
      return 'image.jpg';
    }
    case 'video': {
      return 'video.mp4';
    }
    case 'audio': {
      return 'audio.m4a';
    }
    default: {
      return 'file.bin';
    }
  }
}

/**
 * Walk a raw LINE message into metadata-only attachments. Bytes are
 * downloaded later, on demand, by the platform client's `extractFiles`
 * via the data-domain content endpoint.
 */
export function extractMediaMetadata(message: LineMessage): Attachment[] {
  const attachments: Attachment[] = [];
  if (
    message.type !== 'image' &&
    message.type !== 'video' &&
    message.type !== 'audio' &&
    message.type !== 'file'
  ) {
    return attachments;
  }
  const mimeType = defaultMimeForType(message.type);
  attachments.push({
    mimeType,
    name: defaultNameForType(message.type, (message as { fileName?: string }).fileName),
    type: chatAttachmentType(message.type),
    url: '',
    // Spread the raw payload (already carries `id`) and tack the inferred
    // mimeType on top so server-side `extractFiles` can find both.
    raw: { ...message, mimeType },
  } as Attachment);
  return attachments;
}

function sourceTypeFromEvent(source: LineSource): LineThreadId['type'] {
  return source.type;
}

function sourceIdFromEvent(source: LineSource): string {
  switch (source.type) {
    case 'group': {
      return source.groupId ?? source.userId ?? '';
    }
    case 'room': {
      return source.roomId ?? source.userId ?? '';
    }
    case 'user':
    default: {
      return source.userId ?? '';
    }
  }
}

/**
 * LINE Messaging API adapter for Chat SDK.
 *
 * Owns:
 *   - POST signature verification (`X-Line-Signature` = base64 HMAC-SHA256)
 *   - Per-event fan-out for `type: "message"` events
 *   - Outbound text via the Messaging API push endpoint
 *   - 1:1 typing indicator (loading animation API)
 *
 * Does NOT own:
 *   - Media binary download — handled by the server-side platform client
 *     because `Message.toJSON` strips buffers across the Redis queue.
 *   - Reply-token-based responses — `replyToken` expires in ~60s, so we
 *     always push instead.
 *   - Editing / deleting — LINE doesn't expose either.
 */
export class LineAdapter implements Adapter<LineThreadId, LineMessage> {
  readonly name = 'line';

  private readonly api: LineApiClient;
  private readonly formatConverter: LineFormatConverter;
  private readonly channelSecret: string;
  private readonly destinationUserId: string;

  private _userName: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  constructor(config: LineAdapterConfig & { userName?: string }) {
    if (!config.channelAccessToken) throw new Error('LINE adapter requires channelAccessToken');
    if (!config.channelSecret) throw new Error('LINE adapter requires channelSecret');
    if (!config.destinationUserId) throw new Error('LINE adapter requires destinationUserId');

    this.api = new LineApiClient({
      accessToken: config.channelAccessToken,
      baseUrl: config.apiBaseUrl,
      dataBaseUrl: config.apiDataBaseUrl,
    });
    this.formatConverter = new LineFormatConverter();
    this.channelSecret = config.channelSecret;
    this.destinationUserId = config.destinationUserId;
    this._userName = config.userName || 'line-bot';
  }

  get userName(): string {
    return this._userName;
  }

  get botUserId(): string {
    return this.destinationUserId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();
    this.logger.info('Initialized LINE adapter (destination=%s)', this.destinationUserId);
  }

  // ------------------------------------------------------------------
  // Webhook handling
  // ------------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const bodyText = await request.text();
    const signature = request.headers.get('x-line-signature');
    if (!verifySignature(bodyText, signature, this.channelSecret)) {
      this.logger.warn('Rejected LINE webhook with invalid X-Line-Signature');
      return new Response('Invalid signature', { status: 401 });
    }

    let payload: LineWebhookPayload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (!Array.isArray(payload?.events)) {
      // The "Verify" button in the LINE Developers Console fires a POST
      // with `events: []` — we accept it so the verification handshake
      // succeeds without dispatching to the SDK.
      return Response.json({ ok: true });
    }

    for (const event of payload.events) {
      if (event.type === 'message') {
        await this.dispatchMessageEvent(event as LineMessageEvent, options);
      }
    }

    return Response.json({ ok: true });
  }

  private async dispatchMessageEvent(
    event: LineMessageEvent,
    options?: WebhookOptions,
  ): Promise<void> {
    const message = event.message;
    const source = event.source;
    if (!message?.id || !source) return;

    const sourceId = sourceIdFromEvent(source);
    if (!sourceId) return;

    const threadId = this.encodeThreadId({ id: sourceId, type: sourceTypeFromEvent(source) });
    const senderUserId = source.userId ?? sourceId;
    const messageFactory = async () => this.parseInbound(event, threadId, senderUserId);
    this.chat.processMessage(this, threadId, messageFactory, options);
  }

  // ------------------------------------------------------------------
  // Message operations
  // ------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<LineMessage>> {
    const { id: to } = this.decodeThreadId(threadId);
    const text = this.formatConverter.renderPostable(message);
    await this.api.pushText(to, text);

    const localId = `local_${Date.now()}`;
    return {
      id: localId,
      raw: {
        id: localId,
        text,
        type: 'text',
      },
      threadId,
    };
  }

  async editMessage(
    threadId: string,
    _messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<LineMessage>> {
    // LINE does not support editing — fall back to a new push.
    return this.postMessage(threadId, message);
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    this.logger.warn('Message deletion not supported for LINE');
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<LineMessage>> {
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { id, type } = this.decodeThreadId(threadId);
    return {
      channelId: threadId,
      id: threadId,
      isDM: type === 'user',
      metadata: { id, type },
    };
  }

  // ------------------------------------------------------------------
  // Reactions & typing
  // ------------------------------------------------------------------

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // LINE bots cannot send reactions today — keep a no-op.
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {}

  async startTyping(threadId: string): Promise<void> {
    const { id, type } = this.decodeThreadId(threadId);
    if (type !== 'user') {
      // The loading animation API is only valid for 1:1 user chats.
      return;
    }
    try {
      await this.api.startLoading(id);
    } catch (err) {
      this.logger.warn('startTyping failed: %s', err);
    }
  }

  // ------------------------------------------------------------------
  // Message parsing
  // ------------------------------------------------------------------

  parseMessage(raw: LineMessage, threadId?: string): Message<LineMessage> {
    const text = extractText(raw);
    const formatted = parseMarkdown(text);

    return new Message({
      attachments: extractMediaMetadata(raw),
      author: {
        fullName: this.destinationUserId,
        isBot: false,
        isMe: false,
        userId: this.destinationUserId,
        userName: this.destinationUserId,
      },
      formatted,
      id: raw.id,
      metadata: { dateSent: new Date(), edited: false },
      raw,
      text,
      threadId: threadId ?? this.encodeThreadId({ id: this.destinationUserId, type: 'user' }),
    });
  }

  private parseInbound(
    event: LineMessageEvent,
    threadId: string,
    senderUserId: string,
  ): Message<LineMessage> {
    const text = extractText(event.message);
    const formatted = parseMarkdown(text);

    const author: Author = {
      fullName: senderUserId,
      isBot: false,
      isMe: false,
      userId: senderUserId,
      userName: senderUserId,
    };

    return new Message({
      attachments: extractMediaMetadata(event.message),
      author,
      formatted,
      id: event.message.id,
      metadata: {
        dateSent: new Date(event.timestamp || Date.now()),
        edited: false,
      },
      raw: event.message,
      text,
      threadId,
    });
  }

  // ------------------------------------------------------------------
  // Thread ID encoding
  // ------------------------------------------------------------------

  encodeThreadId(data: LineThreadId): string {
    return `line:${data.type}:${data.id}`;
  }

  decodeThreadId(threadId: string): LineThreadId {
    const parts = threadId.split(':');
    if (parts.length < 3 || parts[0] !== 'line') {
      return { id: threadId, type: 'user' };
    }
    const type = parts[1] as LineThreadId['type'];
    return {
      id: parts.slice(2).join(':'),
      type: type === 'group' || type === 'room' ? type : 'user',
    };
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).type === 'user';
  }

  // ------------------------------------------------------------------
  // Format rendering
  // ------------------------------------------------------------------

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

export function createLineAdapter(config: LineAdapterConfig & { userName?: string }): LineAdapter {
  return new LineAdapter(config);
}

/**
 * Server-side helper: given a raw LINE message, return its `messageId` if it
 * is a downloadable media payload. Used by the platform client's
 * `extractFiles` to know whether to call `LineApiClient.downloadContent`.
 */
export function resolveMediaMessageId(raw: LineMessage | undefined): string | undefined {
  if (!raw) return undefined;
  switch (raw.type) {
    case 'image':
    case 'video':
    case 'audio':
    case 'file': {
      return raw.id;
    }
    default: {
      return undefined;
    }
  }
}

export function getMediaFileNameAndType(raw: LineMessage | undefined): {
  fileName?: string;
  type?: 'audio' | 'file' | 'image' | 'video';
} {
  if (!raw) return {};
  switch (raw.type) {
    case 'image':
    case 'video':
    case 'audio': {
      return { type: raw.type };
    }
    case 'file': {
      return { fileName: raw.fileName, type: 'file' };
    }
    default: {
      return {};
    }
  }
}
