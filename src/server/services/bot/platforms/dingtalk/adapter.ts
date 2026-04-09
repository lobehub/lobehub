import { randomUUID } from 'node:crypto';

import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  BaseFormatConverter,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  Root,
  ThreadInfo,
  WebhookOptions,
} from 'chat';
import {
  BaseFormatConverter as ChatBaseFormatConverter,
  Message,
  parseMarkdown,
  stringifyMarkdown,
} from 'chat';

import { stripMarkdown } from '../stripMarkdown';
import { DingTalkApi } from './api';
import {
  buildDingTalkEncryptedResponse,
  decodeDingTalkThreadId,
  decryptDingTalkEventWithReceiver,
  encodeDingTalkThreadId,
  normalizeDingTalkInboundMessage,
  verifyDingTalkWebhookSignature,
} from './helpers';
import type {
  DingTalkInboundMessagePayload,
  DingTalkNormalizedInboundMessage,
  DingTalkThreadId,
} from './types';

export interface DingTalkAdapterConfig {
  aesKey?: string;
  applicationId?: string;
  botName?: string;
  clientSecret?: string;
  messageType?: 'markdown' | 'text';
  userName?: string;
  verificationToken?: string;
}

class DingTalkFormatConverter extends ChatBaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  toAst(text: string): Root {
    return parseMarkdown(text.trim());
  }
}

export class DingTalkAdapter implements Adapter<DingTalkThreadId, DingTalkInboundMessagePayload> {
  readonly name = 'dingtalk';
  private readonly applicationId?: string;
  private readonly aesKey?: string;
  private readonly api?: DingTalkApi;
  private readonly formatConverter: BaseFormatConverter;
  private readonly messageType: 'markdown' | 'text';
  private readonly verificationToken?: string;
  private _userName: string;
  private botName?: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  get userName(): string {
    return this._userName;
  }

  constructor(config: DingTalkAdapterConfig = {}) {
    this._userName = config.userName || 'dingtalk-bot';
    this.botName = config.botName;
    this.applicationId = config.applicationId;
    this.aesKey = config.aesKey;
    this.formatConverter = new DingTalkFormatConverter();
    this.messageType = config.messageType === 'text' ? 'text' : 'markdown';
    this.verificationToken = config.verificationToken;

    if (config.applicationId && config.clientSecret) {
      this.api = new DingTalkApi({
        appKey: config.applicationId,
        appSecret: config.clientSecret,
      });
    }
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);

    // Prefer the Chat-level configured userName (consistent with other adapters).
    this._userName = chat.getUserName();
    this.botName = this.botName || this._userName;
  }

  // ------------------------------------------------------------------
  // Webhook handling
  // ------------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const bodyText = await request.text();

    let body: DingTalkInboundMessagePayload;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Decrypt encrypted events if needed (DingTalk callback mode).
    if (typeof body.encrypt === 'string' && body.encrypt) {
      if (!this.aesKey || !this.verificationToken || !this.applicationId) {
        return new Response(
          'Encrypted event but no aesKey/verificationToken/applicationId configured',
          {
            status: 401,
          },
        );
      }

      let decryptedReceiverId: string | undefined;

      const url = new URL(request.url);
      const signature =
        url.searchParams.get('msg_signature') || url.searchParams.get('signature') || '';
      const timestamp =
        url.searchParams.get('timestamp') || url.searchParams.get('timeStamp') || '';
      const nonce = url.searchParams.get('nonce') || '';

      if (!signature || !timestamp || !nonce) {
        return new Response('Missing signature params', { status: 400 });
      }

      const ok = verifyDingTalkWebhookSignature({
        encrypt: body.encrypt,
        nonce,
        signature,
        timestamp,
        token: this.verificationToken,
      });

      if (!ok) return new Response('Invalid signature', { status: 401 });

      try {
        const decrypted = decryptDingTalkEventWithReceiver(body.encrypt, this.aesKey);
        decryptedReceiverId = decrypted.receiverId || this.applicationId;

        body = JSON.parse(decrypted.message);
      } catch (error) {
        this.logger.error('Event decryption failed: %s', String(error));
        return new Response('Decryption failed', { status: 401 });
      }

      // Callback URL verification handshake (EventType: check_url).
      // DingTalk expects an encrypted payload for plaintext "success".
      if ((body as Record<string, unknown>).EventType === 'check_url') {
        return Response.json(
          buildDingTalkEncryptedResponse({
            aesKey: this.aesKey,
            nonce,
            receiverId: decryptedReceiverId || this.applicationId,
            timestamp,
            token: this.verificationToken,
          }),
        );
      }
    }

    // Best-effort URL verification (plaintext challenge).
    const challenge = (body as Record<string, unknown>).challenge;
    if (typeof challenge === 'string' && challenge) {
      return Response.json({ challenge });
    }

    const normalized = normalizeDingTalkInboundMessage(body, {
      botName: this.botName || this._userName,
      requireMentionInGroup: true,
      stripBotMention: true,
    });

    if (!normalized) return Response.json({ ok: true });

    const messageFactory = () => this.parseNormalizedEvent(normalized);
    this.chat.processMessage(this, normalized.threadId, messageFactory, options);

    return Response.json({ ok: true });
  }

  // ------------------------------------------------------------------
  // Message operations (outbound — deferred to Task 4)
  // ------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<DingTalkInboundMessagePayload>> {
    return this.sendPostableMessage(threadId, message);
  }

  async editMessage(
    threadId: string,
    _messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<DingTalkInboundMessagePayload>> {
    return this.sendPostableMessage(threadId, message);
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError('DingTalk deleteMessage is not implemented yet');
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // DingTalk bot webhook mode doesn't expose reactions in scope of Task 3.
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // DingTalk bot webhook mode doesn't expose reactions in scope of Task 3.
  }

  async startTyping(_threadId: string): Promise<void> {
    // DingTalk doesn't provide a typing indicator for bots (in this runtime).
  }

  // ------------------------------------------------------------------
  // Fetching (not supported in webhook MVP)
  // ------------------------------------------------------------------

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<DingTalkInboundMessagePayload>> {
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = this.decodeThreadId(threadId);
    return {
      channelId: threadId,
      id: threadId,
      isDM: decoded.type === 'dm',
      metadata: { id: decoded.id, type: decoded.type },
    };
  }

  // ------------------------------------------------------------------
  // Message parsing
  // ------------------------------------------------------------------

  parseMessage(raw: DingTalkInboundMessagePayload): Message<DingTalkInboundMessagePayload> {
    const normalized = normalizeDingTalkInboundMessage(raw, {
      botName: this.botName || this._userName,
      requireMentionInGroup: false,
      stripBotMention: false,
    });

    const threadId = normalized?.threadId || buildFallbackThreadId(raw);
    const text = normalized?.text || '';
    const formatted = parseMarkdown(text);

    const authorId = normalized?.authorId || raw.senderId || 'unknown';
    const authorName = normalized?.authorName || raw.senderNick || authorId;
    const author: Author = {
      fullName: authorName,
      isBot: false,
      isMe: false,
      userId: authorId,
      userName: authorName,
    };

    const message = new Message<DingTalkInboundMessagePayload>({
      attachments: [],
      author,
      formatted,
      id: normalized?.id || raw.msgId || '',
      metadata: {
        dateSent: normalized?.timestamp || new Date(),
        edited: false,
      },
      raw,
      text,
      threadId,
    });

    message.isMention = normalized?.isMention;
    return message;
  }

  private async parseNormalizedEvent(
    normalized: DingTalkNormalizedInboundMessage,
  ): Promise<Message<DingTalkInboundMessagePayload>> {
    const formatted = parseMarkdown(normalized.text);
    const authorId = normalized.authorId;
    const authorName = normalized.authorName || authorId;

    const author: Author = {
      fullName: authorName,
      isBot: false,
      isMe: false,
      userId: authorId,
      userName: authorName,
    };

    const message = new Message<DingTalkInboundMessagePayload>({
      attachments: [],
      author,
      formatted,
      id: normalized.id,
      metadata: { dateSent: normalized.timestamp, edited: false },
      raw: normalized.raw,
      text: normalized.text,
      threadId: normalized.threadId,
    });

    // Preserve structured mention information (Chat SDK's "@username" check can be defeated by stripping).
    message.isMention = normalized.isMention;
    return message;
  }

  // ------------------------------------------------------------------
  // Thread ID encoding
  // ------------------------------------------------------------------

  encodeThreadId(platformData: DingTalkThreadId): string {
    return encodeDingTalkThreadId(platformData);
  }

  decodeThreadId(threadId: string): DingTalkThreadId {
    return decodeDingTalkThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).type === 'dm';
  }

  // ------------------------------------------------------------------
  // Format rendering
  // ------------------------------------------------------------------

  renderFormatted(content: FormattedContent): string {
    return stringifyMarkdown(content);
  }

  private formatPostableMessage(message: AdapterPostableMessage): string {
    const rendered = this.formatConverter.renderPostable(message);
    return this.messageType === 'text' ? stripMarkdown(rendered) : rendered;
  }

  private async sendPostableMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<DingTalkInboundMessagePayload>> {
    if (!this.api) {
      throw new Error('DingTalk adapter is missing outbound credentials');
    }

    const thread = this.decodeThreadId(threadId);
    const content = this.formatPostableMessage(message);
    const response = await this.api.sendTextMessage({
      content,
      messageType: this.messageType,
      ...(thread.type === 'group' ? { openConversationId: thread.id } : { userIds: [thread.id] }),
      title: 'LobeHub',
    });

    const responseMessageId =
      typeof response === 'object' && response && 'messageId' in response
        ? response.messageId
        : undefined;
    const messageId = typeof responseMessageId === 'string' ? responseMessageId : randomUUID();

    return {
      id: messageId,
      raw: {
        msgId: messageId,
        text: { content },
      },
      threadId,
    };
  }
}

const buildFallbackThreadId = (raw: DingTalkInboundMessagePayload): string => {
  const senderId = raw.senderId || 'unknown';
  return encodeDingTalkThreadId({ id: senderId, type: 'dm' });
};

export const createDingTalkAdapter = (config: DingTalkAdapterConfig = {}): DingTalkAdapter =>
  new DingTalkAdapter(config);
