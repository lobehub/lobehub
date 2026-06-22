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

import { MatrixApiClient } from './api';
import { markdownToMatrixHtml, MatrixFormatConverter } from './format-converter';
import { MatrixSyncConnection } from './sync';
import type {
  MatrixAdapterConfig,
  MatrixMessageContent,
  MatrixRoomEvent,
  MatrixThreadId,
  MatrixWebhookPayload,
} from './types';

const THREAD_PREFIX = 'matrix';

/** Map a Matrix media `msgtype` to a Chat SDK attachment type. */
function attachmentTypeForMsgtype(msgtype: string | undefined): Attachment['type'] | undefined {
  switch (msgtype) {
    case 'm.image': {
      return 'image';
    }
    case 'm.video': {
      return 'video';
    }
    case 'm.audio': {
      return 'audio';
    }
    case 'm.file': {
      return 'file';
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Pull user-visible text from a Matrix message event. Media payloads surface a
 * placeholder (filename/body) so the LLM knows something was attached.
 */
function extractText(content: MatrixMessageContent): string {
  const type = attachmentTypeForMsgtype(content.msgtype);
  if (type) {
    const name = content.filename ?? content.body;
    return name ? `[${type}: ${name}]` : `[${type}]`;
  }
  return content.body ?? '';
}

/** Build metadata-only attachments; bytes are downloaded later server-side. */
export function extractMediaMetadata(event: MatrixRoomEvent): Attachment[] {
  const content = event.content;
  const type = attachmentTypeForMsgtype(content.msgtype);
  if (!type || !content.url) return [];
  return [
    {
      mimeType: content.info?.mimetype,
      name: content.filename ?? content.body ?? type,
      type,
      url: '',
      // Preserve the mxc url + info so the platform client's `extractFiles`
      // can re-download via `MatrixApiClient.downloadMedia` (closures and
      // buffers don't survive `Message.toJSON` across the Redis queue).
      raw: { info: content.info, msgtype: content.msgtype, url: content.url },
    } as Attachment,
  ];
}

/**
 * Matrix Client-Server API adapter for the Chat SDK.
 *
 * Inbound: a {@link MatrixSyncConnection} long-polls `/sync` and POSTs each
 * message event to the internal webhook, which lands in {@link handleWebhook}.
 * Outbound: `m.notice` events with an `org.matrix.custom.html` formatted body.
 *
 * Does NOT own media binary download (the platform client re-downloads via the
 * mxc url) or E2EE (unencrypted rooms only in this version).
 */
export class MatrixAdapter implements Adapter<MatrixThreadId, MatrixRoomEvent> {
  readonly name = THREAD_PREFIX;

  private readonly api: MatrixApiClient;
  private readonly formatConverter: MatrixFormatConverter;
  private readonly _botUserId: string;

  private _userName: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  constructor(config: MatrixAdapterConfig) {
    if (!config.homeserverUrl) throw new Error('Matrix adapter requires homeserverUrl');
    if (!config.accessToken) throw new Error('Matrix adapter requires accessToken');
    if (!config.userId) throw new Error('Matrix adapter requires userId');

    this.api = new MatrixApiClient({
      accessToken: config.accessToken,
      homeserverUrl: config.homeserverUrl,
    });
    this.formatConverter = new MatrixFormatConverter();
    this._botUserId = config.userId;
    this._userName = config.userName || config.userId;
  }

  get botUserId(): string {
    return this._botUserId;
  }

  get userName(): string {
    return this._userName;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();
    this.logger.info('Initialized Matrix adapter (bot=%s)', this._botUserId);
  }

  // ------------------------------------------------------------------
  // Persistent /sync listener (called by the platform client)
  // ------------------------------------------------------------------

  /**
   * Open the persistent `/sync` loop. Resolves once the initial sync succeeds
   * (so the caller can mark the provider connected); the long-poll loop then
   * continues in the background via `waitUntil`.
   */
  async startSyncListener(
    options: { waitUntil: (task: Promise<any>) => void },
    durationMs: number,
    abortSignal: AbortSignal,
    webhookUrl: string,
  ): Promise<void> {
    const connection = new MatrixSyncConnection(this.api, {
      abortSignal,
      botUserId: this._botUserId,
      durationMs,
      log: (msg: string, ...rest: any[]) => this.logger?.info(msg, ...rest),
      webhookUrl,
    });

    await connection.bootstrap();
    options.waitUntil(connection.poll());
  }

  // ------------------------------------------------------------------
  // Webhook handling (forwarded /sync events)
  // ------------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let payload: MatrixWebhookPayload;
    try {
      payload = (await request.json()) as MatrixWebhookPayload;
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const event = payload?.event;
    if (!event?.event_id || !payload.room_id) return Response.json({ ok: true });
    if (event.sender === this._botUserId) return Response.json({ ok: true });

    const threadId = this.encodeThreadId({ isDirect: payload.is_direct, roomId: payload.room_id });
    const messageFactory = async () => this.parseInbound(event, threadId);
    this.chat.processMessage(this, threadId, messageFactory, options);

    return Response.json({ ok: true });
  }

  // ------------------------------------------------------------------
  // Message operations
  // ------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<MatrixRoomEvent>> {
    const { roomId } = this.decodeThreadId(threadId);
    const body = this.formatConverter.renderPostable(message);
    const content = buildMessageContent(body);
    const res = await this.api.sendMessage(roomId, content);
    return {
      id: res.event_id,
      raw: { content, event_id: res.event_id, sender: this._botUserId, type: 'm.room.message' },
      threadId,
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<MatrixRoomEvent>> {
    const { roomId } = this.decodeThreadId(threadId);
    const body = this.formatConverter.renderPostable(message);
    const content = buildMessageContent(body);
    const res = await this.api.editMessage(roomId, messageId, content);
    return {
      id: res.event_id,
      raw: { content, event_id: res.event_id, sender: this._botUserId, type: 'm.room.message' },
      threadId,
    };
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { roomId } = this.decodeThreadId(threadId);
    await this.api.redactEvent(roomId, messageId);
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<MatrixRoomEvent>> {
    // History backfill via /messages is out of scope for v1.
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { isDirect, roomId } = this.decodeThreadId(threadId);
    return {
      channelId: roomId,
      id: threadId,
      isDM: isDirect === true,
      metadata: { roomId },
    };
  }

  // ------------------------------------------------------------------
  // Reactions & typing
  // ------------------------------------------------------------------

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    const { roomId } = this.decodeThreadId(threadId);
    const key = typeof emoji === 'string' ? emoji : String(emoji);
    try {
      await this.api.sendReaction(roomId, messageId, key);
    } catch (err) {
      this.logger?.warn('addReaction failed: %s', err);
    }
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // Removing a Matrix reaction requires redacting the original m.reaction
    // event, whose id we don't track here. Left as a no-op for v1.
  }

  async startTyping(threadId: string): Promise<void> {
    const { roomId } = this.decodeThreadId(threadId);
    try {
      await this.api.sendTyping(roomId, this._botUserId, true);
    } catch (err) {
      this.logger?.warn('startTyping failed: %s', err);
    }
  }

  // ------------------------------------------------------------------
  // Message parsing
  // ------------------------------------------------------------------

  parseMessage(raw: MatrixRoomEvent): Message<MatrixRoomEvent> {
    return this.parseInbound(raw, this.encodeThreadId({ roomId: '' }));
  }

  private parseInbound(event: MatrixRoomEvent, threadId: string): Message<MatrixRoomEvent> {
    const text = extractText(event.content);
    const author: Author = {
      fullName: event.sender,
      isBot: false,
      isMe: event.sender === this._botUserId,
      userId: event.sender,
      userName: event.sender,
    };

    return new Message({
      attachments: extractMediaMetadata(event),
      author,
      formatted: parseMarkdown(text),
      id: event.event_id,
      metadata: { dateSent: new Date(event.origin_server_ts || Date.now()), edited: false },
      raw: event,
      text,
      threadId,
    });
  }

  // ------------------------------------------------------------------
  // Thread ID encoding
  // ------------------------------------------------------------------

  encodeThreadId(data: MatrixThreadId): string {
    return `${THREAD_PREFIX}:${data.isDirect ? 'd' : 'g'}:${data.roomId}`;
  }

  decodeThreadId(threadId: string): MatrixThreadId {
    const parts = threadId.split(':');
    if (parts.length < 3 || parts[0] !== THREAD_PREFIX) {
      return { isDirect: false, roomId: threadId };
    }
    // Room IDs contain colons (`!opaque:server`), so rejoin everything after
    // the type segment.
    return { isDirect: parts[1] === 'd', roomId: parts.slice(2).join(':') };
  }

  /** The room IS the channel — used by group allowlist matching. */
  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).roomId;
  }

  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).isDirect === true;
  }

  // ------------------------------------------------------------------
  // Format rendering
  // ------------------------------------------------------------------

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content as any);
  }
}

/**
 * Build an `m.notice` content with an HTML formatted body. Bots send
 * `m.notice` (not `m.text`) by convention so clients can visually
 * distinguish automated messages. The plain `body` stays as Markdown — the
 * fallback Matrix clients render when they don't support `formatted_body`.
 */
function buildMessageContent(body: string): MatrixMessageContent {
  const html = markdownToMatrixHtml(body);
  const content: MatrixMessageContent = { body, msgtype: 'm.notice' };
  if (html) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = html;
  }
  return content;
}

export function createMatrixAdapter(config: MatrixAdapterConfig): MatrixAdapter {
  return new MatrixAdapter(config);
}
