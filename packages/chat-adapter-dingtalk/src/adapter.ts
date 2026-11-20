import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
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
import { Message, RateLimitError } from 'chat';
import mime from 'mime';

import { DingTalkApiClient, DingTalkApiError, MAX_MSG_PARAM_TEXT_BYTES, truncateUtf8 } from './api';
import { verifyCallbackSignature } from './crypto';
import { DingTalkFormatConverter } from './format-converter';
import { DingTalkStreamConnection } from './gateway';
import type {
  DingTalkAdapterConfig,
  DingTalkOutboundMessage,
  DingTalkRawMessage,
  DingTalkThreadId,
} from './types';
import { DINGTALK_CONVERSATION_TYPE } from './types';

/** Treat a sessionWebhook as expired this long before its stated expiry. */
const SESSION_WEBHOOK_EXPIRY_MARGIN_MS = 30_000;
const MAX_CACHED_SESSION_WEBHOOKS = 1000;

interface SessionWebhookEntry {
  expiresAt: number;
  url: string;
}

export class DingTalkAdapter implements Adapter<DingTalkThreadId, DingTalkRawMessage> {
  readonly name = 'dingtalk';
  private readonly api: DingTalkApiClient;
  private readonly clientSecret: string;
  private readonly formatConverter: DingTalkFormatConverter;
  /** Latest reply webhook per thread, learned from inbound callbacks. */
  private readonly sessionWebhooks = new Map<string, SessionWebhookEntry>();
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

  constructor(config: DingTalkAdapterConfig & { userName?: string }) {
    this.api = new DingTalkApiClient(config.clientId, config.clientSecret, config.robotCode);
    this.clientSecret = config.clientSecret;
    this.formatConverter = new DingTalkFormatConverter();
    this._userName = config.userName || 'dingtalk-bot';
  }

  get apiClient(): DingTalkApiClient {
    return this.api;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();

    // Validate credentials
    await this.api.getAccessToken();

    this.logger.info('Initialized DingTalk adapter (robotCode=%s)', this.api.robotCode);
  }

  // ------------------------------------------------------------------
  // Webhook handling
  // ------------------------------------------------------------------

  /**
   * Handle a robot message callback: either forwarded by the Stream gateway or
   * delivered by DingTalk's HTTP callback mode. Both carry `timestamp` + `sign`
   * headers signed with the Client Secret.
   */
  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const bodyText = await request.text();

    if (
      !verifyCallbackSignature(
        request.headers.get('timestamp'),
        request.headers.get('sign'),
        this.clientSecret,
      )
    ) {
      return new Response('Invalid signature', { status: 401 });
    }

    let payload: DingTalkRawMessage;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (!payload?.msgId || !payload.conversationId || !payload.senderId) {
      return Response.json({ ok: true });
    }

    if (payload.chatbotUserId) this._botUserId = payload.chatbotUserId;
    if (payload.chatbotUserId && payload.senderId === payload.chatbotUserId) {
      return Response.json({ ok: true });
    }

    const threadId = this.threadIdFromRaw(payload);
    this.rememberSessionWebhook(threadId, payload);

    const message = this.parseMessage(payload);
    if (!message.text.trim() && message.attachments.length === 0) {
      return Response.json({ ok: true });
    }

    this.chat.processMessage(this, threadId, () => Promise.resolve(message), options);

    return Response.json({ ok: true });
  }

  // ------------------------------------------------------------------
  // Gateway listener (Stream mode)
  // ------------------------------------------------------------------

  /**
   * Start a Stream mode connection. Robot message callbacks are ACKed on the
   * socket and forwarded to `webhookUrl` as signed HTTP POSTs, reusing the
   * `handleWebhook()` pipeline.
   */
  async startGatewayListener(
    options: { waitUntil: (task: Promise<any>) => void },
    durationMs: number,
    abortSignal: AbortSignal,
    webhookUrl: string,
  ): Promise<void> {
    const gateway = new DingTalkStreamConnection(this.api, {
      abortSignal,
      clientSecret: this.clientSecret,
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
  ): Promise<RawMessage<DingTalkRawMessage>> {
    const text = truncateUtf8(
      this.formatConverter.renderPostable(message).trim(),
      MAX_MSG_PARAM_TEXT_BYTES,
    );
    const outbound = this.formatConverter.toOutboundMessage(message, text);
    const id = await this.send(threadId, outbound);

    return {
      id,
      raw: {
        conversationId: this.decodeThreadId(threadId).id,
        conversationType: this.isDM(threadId)
          ? DINGTALK_CONVERSATION_TYPE.SINGLE
          : DINGTALK_CONVERSATION_TYPE.GROUP,
        createAt: Date.now(),
        msgId: id,
        msgtype: outbound.msgKey === 'sampleText' ? 'text' : 'markdown',
        senderId: this._botUserId || '',
        text: { content: text },
      },
      threadId,
    };
  }

  /** Send an image by public URL or media ID. */
  async postImage(threadId: string, photoURL: string): Promise<string> {
    return this.send(threadId, { msgKey: 'sampleImageMsg', msgParam: { photoURL } });
  }

  /**
   * Deliver through the thread's sessionWebhook while it is valid (saves the
   * organisation's API quota), falling back to the robot OpenAPI when it is
   * missing, expired or rejected.
   */
  private async send(threadId: string, outbound: DingTalkOutboundMessage): Promise<string> {
    const session = this.getSessionWebhook(threadId);
    if (session) {
      try {
        await this.api.replyViaSessionWebhook(session.url, outbound);
        return `session:${Date.now()}`;
      } catch (err) {
        this.sessionWebhooks.delete(threadId);
        this.logger?.warn('sessionWebhook failed, falling back to OpenAPI: %s', String(err));
      }
    }

    const { type, id } = this.decodeThreadId(threadId);
    try {
      const result =
        type === 'group'
          ? await this.api.sendGroupMessage(id, outbound)
          : await this.api.sendSingleMessage([id], outbound);
      return result.processQueryKey;
    } catch (err) {
      if (err instanceof DingTalkApiError && err.kind === 'rate_limit') {
        throw new RateLimitError(err.message, undefined, err);
      }
      throw err;
    }
  }

  async editMessage(
    threadId: string,
    _messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<DingTalkRawMessage>> {
    // Robot text/markdown messages cannot be edited — post a new message
    return this.postMessage(threadId, message);
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    this.logger.warn('Message deletion not implemented for DingTalk');
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<DingTalkRawMessage>> {
    // Robots have no message history API
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

  parseMessage(raw: DingTalkRawMessage): Message<DingTalkRawMessage> {
    const threadId = this.threadIdFromRaw(raw);
    const { text, attachments } = this.extractContent(raw);
    const cleanText = this.formatConverter.cleanText(text);
    const isGroup = raw.conversationType === DINGTALK_CONVERSATION_TYPE.GROUP;
    const userId = raw.senderStaffId || raw.senderId;
    const isMe = !!raw.chatbotUserId && raw.senderId === raw.chatbotUserId;

    return new Message({
      attachments,
      author: {
        fullName: raw.senderNick || userId,
        isBot: isMe,
        isMe,
        userId,
        userName: raw.senderNick || userId,
      },
      formatted: this.formatConverter.toAst(cleanText),
      id: raw.msgId,
      // Group callbacks are only delivered when the robot is @-mentioned.
      isMention: isGroup || !!raw.isInAtList,
      metadata: {
        dateSent: new Date(raw.createAt || Date.now()),
        edited: false,
      },
      raw,
      text: cleanText,
      threadId,
    });
  }

  private extractContent(raw: DingTalkRawMessage): { attachments: Attachment[]; text: string } {
    const content = raw.content;
    switch (raw.msgtype) {
      case 'text': {
        return { attachments: [], text: raw.text?.content ?? '' };
      }
      case 'richText': {
        const attachments: Attachment[] = [];
        const parts: string[] = [];
        for (const item of content?.richText ?? []) {
          if (item.text) parts.push(item.text);
          const code = item.downloadCode || item.pictureDownloadCode;
          if (code) attachments.push(this.buildAttachment('image', code));
        }
        return { attachments, text: parts.join('') };
      }
      case 'picture': {
        const code = content?.downloadCode || content?.pictureDownloadCode;
        return { attachments: code ? [this.buildAttachment('image', code)] : [], text: '' };
      }
      case 'audio': {
        const code = content?.downloadCode;
        return {
          attachments: code ? [this.buildAttachment('audio', code)] : [],
          // DingTalk ships a speech-to-text transcript with voice messages.
          text: content?.recognition ?? '',
        };
      }
      case 'video': {
        const code = content?.downloadCode;
        return { attachments: code ? [this.buildAttachment('video', code)] : [], text: '' };
      }
      case 'file': {
        const code = content?.downloadCode;
        return {
          attachments: code ? [this.buildAttachment('file', code, content?.fileName)] : [],
          text: '',
        };
      }
      default: {
        return { attachments: [], text: raw.text?.content ?? '' };
      }
    }
  }

  /**
   * DingTalk ships a `downloadCode`, not a URL; `fetchData` exchanges it via
   * `robot/messageFiles/download`. `fetchMetadata` keeps the code so the
   * fetcher can be rebuilt after queue serialization.
   */
  private buildAttachment(
    type: Attachment['type'],
    downloadCode: string,
    fileName?: string,
  ): Attachment {
    return {
      fetchData: () => this.api.downloadFile(downloadCode),
      fetchMetadata: { downloadCode },
      mimeType: (fileName && mime.getType(fileName)) || undefined,
      name: fileName,
      type,
    };
  }

  // ------------------------------------------------------------------
  // sessionWebhook cache
  // ------------------------------------------------------------------

  private rememberSessionWebhook(threadId: string, raw: DingTalkRawMessage): void {
    if (!raw.sessionWebhook || !raw.sessionWebhookExpiredTime) return;
    this.sessionWebhooks.delete(threadId);
    this.sessionWebhooks.set(threadId, {
      expiresAt: raw.sessionWebhookExpiredTime,
      url: raw.sessionWebhook,
    });
    if (this.sessionWebhooks.size > MAX_CACHED_SESSION_WEBHOOKS) {
      const oldest = this.sessionWebhooks.keys().next().value;
      if (oldest !== undefined) this.sessionWebhooks.delete(oldest);
    }
  }

  private getSessionWebhook(threadId: string): SessionWebhookEntry | undefined {
    const entry = this.sessionWebhooks.get(threadId);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt - SESSION_WEBHOOK_EXPIRY_MARGIN_MS) {
      this.sessionWebhooks.delete(threadId);
      return undefined;
    }
    return entry;
  }

  // ------------------------------------------------------------------
  // Reactions / typing (not supported for robots)
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

  async startTyping(_threadId: string): Promise<void> {}

  // ------------------------------------------------------------------
  // Thread ID encoding
  // ------------------------------------------------------------------

  private threadIdFromRaw(raw: DingTalkRawMessage): string {
    if (raw.conversationType === DINGTALK_CONVERSATION_TYPE.GROUP) {
      return this.encodeThreadId({ id: raw.conversationId, type: 'group' });
    }
    return this.encodeThreadId({ id: raw.senderStaffId || raw.senderId, type: 'single' });
  }

  encodeThreadId(data: DingTalkThreadId): string {
    return `dingtalk:${data.type}:${data.id}`;
  }

  decodeThreadId(threadId: string): DingTalkThreadId {
    const [prefix, type, ...rest] = threadId.split(':');
    if (prefix !== 'dingtalk' || (type !== 'single' && type !== 'group') || rest.length === 0) {
      return { id: threadId, type: 'group' };
    }
    return { id: rest.join(':'), type };
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).type === 'single';
  }

  // ------------------------------------------------------------------
  // Format rendering
  // ------------------------------------------------------------------

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

/**
 * Factory function to create a DingTalkAdapter.
 */
export function createDingTalkAdapter(
  config: DingTalkAdapterConfig & { userName?: string },
): DingTalkAdapter {
  return new DingTalkAdapter(config);
}
