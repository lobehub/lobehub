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
  Root,
  ThreadInfo,
  WebhookOptions,
} from 'chat';
import { BaseFormatConverter, Message, parseMarkdown, stringifyMarkdown } from 'chat';

import {
  type BotWebhookCallbackTarget,
  newOutboundMessageId,
  sendBotWebhookEvent,
} from './callback';
import {
  BOT_WEBHOOK_HEADERS,
  BOT_WEBHOOK_MAX_BODY_BYTES,
  BOT_WEBHOOK_OUTBOUND_EVENTS,
  type BotWebhookInboundMessage,
  BotWebhookInboundSchema,
  type BotWebhookThread,
  decodeWebhookThreadId,
  encodeWebhookThreadId,
  WEBHOOK_PLATFORM_ID,
} from './protocol';
import { verifyInboundSignature } from './signature';

/** Markdown in, Markdown out: the developer's platform decides how to render it. */
class BotWebhookFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  toAst(text: string): Root {
    return parseMarkdown(text.trim());
  }
}

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

/** Inbound attachments become metadata; the platform client downloads them on demand. */
const toAttachments = (message: BotWebhookInboundMessage): Attachment[] =>
  (message.attachments ?? []).map(
    (attachment) =>
      ({
        mimeType: attachment.mimeType,
        name: attachment.name,
        raw: attachment,
        size: attachment.size,
        type: attachment.type,
        url: attachment.url,
      }) as Attachment,
  );

const toDate = (timestamp: BotWebhookInboundMessage['timestamp']) => {
  if (timestamp === undefined) return new Date();
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

/**
 * Chat SDK adapter for the custom webhook channel: any platform that can sign an HTTP
 * POST can talk to an agent.
 *
 * Owns inbound verification (HMAC signature + timestamp window), payload validation and
 * fan-out to the Chat SDK, and outbound text posts to the callback URL. Attachments on
 * replies go through the platform client's messenger, which carries them.
 */
export class BotWebhookAdapter implements Adapter<BotWebhookThread, BotWebhookInboundMessage> {
  readonly name = WEBHOOK_PLATFORM_ID;

  private readonly formatConverter = new BotWebhookFormatConverter();
  private readonly target: BotWebhookCallbackTarget;
  private _userName: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  constructor(target: BotWebhookCallbackTarget & { userName?: string }) {
    if (!target.signingSecret) throw new Error('Webhook adapter requires a signing secret');
    if (!target.callbackUrl) throw new Error('Webhook adapter requires a callback URL');
    this.target = target;
    this._userName = target.userName || target.botId;
  }

  get userName(): string {
    return this._userName;
  }

  get botUserId(): string {
    return this.target.botId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();
  }

  // ------------------------------------------------------------------
  // Webhook handling
  // ------------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > BOT_WEBHOOK_MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });
    const body = await request.text();
    if (Buffer.byteLength(body) > BOT_WEBHOOK_MAX_BODY_BYTES)
      return json(413, { error: 'payload_too_large' });

    const verdict = verifyInboundSignature({
      body,
      secret: this.target.signingSecret,
      signature: request.headers.get(BOT_WEBHOOK_HEADERS.signature),
      timestamp: request.headers.get(BOT_WEBHOOK_HEADERS.timestamp),
    });
    if (!verdict.ok) {
      this.logger?.warn('Rejected webhook bot request: %s', verdict.reason);
      return json(401, { error: verdict.reason });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      return json(400, { error: 'invalid_json' });
    }

    const parsed = BotWebhookInboundSchema.safeParse(raw);
    if (!parsed.success) {
      return json(400, {
        error: 'invalid_payload',
        issues: parsed.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.join('.'),
        })),
      });
    }

    if (parsed.data.type === 'ping') return json(200, { ok: true });

    const message = parsed.data.message;
    const threadId = this.encodeThreadId({
      conversationId: message.conversationId,
      isDirect: message.isDirect,
      threadId: message.threadId,
    });
    this.chat.processMessage(
      this,
      threadId,
      async () => this.parseMessage(message, threadId),
      options,
    );

    return json(200, { ok: true, threadId });
  }

  // ------------------------------------------------------------------
  // Message operations
  // ------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<BotWebhookInboundMessage>> {
    return this.send(threadId, newOutboundMessageId(), message, 'created');
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<BotWebhookInboundMessage>> {
    return this.send(threadId, messageId, message, 'updated');
  }

  private async send(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
    kind: 'created' | 'updated',
  ): Promise<RawMessage<BotWebhookInboundMessage>> {
    const thread = this.decodeThreadId(threadId);
    // The Markdown stringifier ends with a newline the receiver would have to strip.
    const text = this.formatConverter.renderPostable(message).trimEnd();
    await sendBotWebhookEvent(
      this.target,
      kind === 'created'
        ? BOT_WEBHOOK_OUTBOUND_EVENTS.messageCreated
        : BOT_WEBHOOK_OUTBOUND_EVENTS.messageUpdated,
      {
        attachments: [],
        conversationId: thread.conversationId,
        isDirect: thread.isDirect,
        messageId,
        replyTo: null,
        text,
        threadId: thread.threadId ?? null,
      },
    );
    return {
      id: messageId,
      raw: {
        conversationId: thread.conversationId,
        id: messageId,
        isDirect: thread.isDirect,
        mentioned: false,
        text,
        threadId: thread.threadId,
        user: { id: this.target.botId },
      },
      threadId,
    };
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    this.logger?.warn('Message deletion is not part of the webhook channel protocol');
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<BotWebhookInboundMessage>> {
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const thread = this.decodeThreadId(threadId);
    return {
      channelId: threadId,
      id: threadId,
      isDM: thread.isDirect,
      metadata: { ...thread },
    };
  }

  // ------------------------------------------------------------------
  // Reactions & typing — not part of the protocol
  // ------------------------------------------------------------------

  async addReaction(_threadId: string, _messageId: string, _emoji: EmojiValue | string) {}

  async removeReaction(_threadId: string, _messageId: string, _emoji: EmojiValue | string) {}

  async startTyping(_threadId: string): Promise<void> {}

  // ------------------------------------------------------------------
  // Message parsing
  // ------------------------------------------------------------------

  parseMessage(
    raw: BotWebhookInboundMessage,
    threadId?: string,
  ): Message<BotWebhookInboundMessage> {
    const text = raw.text ?? '';
    const resolvedThreadId =
      threadId ??
      this.encodeThreadId({
        conversationId: raw.conversationId,
        isDirect: raw.isDirect,
        threadId: raw.threadId,
      });
    return new Message({
      attachments: toAttachments(raw),
      author: {
        fullName: raw.user.name || raw.user.id,
        isBot: false,
        isMe: false,
        userId: raw.user.id,
        userName: raw.user.name || raw.user.id,
      },
      formatted: parseMarkdown(text),
      // The Chat SDK deduplicates on the message id across the whole agent, while many
      // platforms number messages per chat: scope the developer's id to its thread.
      id: `${resolvedThreadId}#${raw.id}`,
      isMention: raw.isDirect || raw.mentioned,
      metadata: { dateSent: toDate(raw.timestamp), edited: false },
      raw,
      text,
      threadId: resolvedThreadId,
    });
  }

  // ------------------------------------------------------------------
  // Thread ID encoding
  // ------------------------------------------------------------------

  encodeThreadId(data: BotWebhookThread): string {
    return encodeWebhookThreadId(data);
  }

  decodeThreadId(threadId: string): BotWebhookThread {
    return decodeWebhookThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).isDirect;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

export const createBotWebhookAdapter = (
  target: BotWebhookCallbackTarget & { userName?: string },
): BotWebhookAdapter => new BotWebhookAdapter(target);
