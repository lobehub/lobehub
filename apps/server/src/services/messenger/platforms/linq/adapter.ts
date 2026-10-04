import type {
  LinqApiClient,
  LinqInboundMessage,
  LinqMessagePart,
  LinqWebhookEvent,
} from '@lobechat/agent-address-linq';
import { markdownToPlainText } from '@lobechat/agent-address-linq';
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Author,
  ChatInstance,
  EmojiValue,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  Root,
  ThreadInfo,
  WebhookOptions,
} from 'chat';
import { BaseFormatConverter, Message, parseMarkdown, stringifyMarkdown } from 'chat';

import { linqSenderHandle } from './handle';
import { decodeLinqThreadId, encodeLinqThreadId } from './threadId';

/** The only Linq event that carries a message from a person. */
export const LINQ_MESSAGE_RECEIVED_EVENT = 'message.received';

class LinqFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  toAst(text: string): Root {
    return parseMarkdown(text.trim());
  }
}

const partsToText = (parts: LinqMessagePart[] | undefined): string =>
  (parts ?? [])
    .filter((part): part is Extract<LinqMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.value)
    .join('\n')
    .trim();

const partsToAttachments = (parts: LinqMessagePart[] | undefined): Attachment[] =>
  (parts ?? [])
    .filter(
      (part): part is Extract<LinqMessagePart, { type: 'media' }> =>
        part.type === 'media' && !!part.url,
    )
    .map(
      (part) =>
        ({
          mimeType: 'application/octet-stream',
          name: part.url!.split('/').pop()?.split('?')[0] || 'attachment',
          raw: part,
          type: 'file',
          url: part.url!,
        }) as Attachment,
    );

export interface LinqChatAdapterConfig {
  api: LinqApiClient;
}

/**
 * Chat SDK adapter over LobeHub's shared Linq number pool.
 *
 * Signature verification and replay de-duplication already ran in the
 * messenger webhook gate, so this adapter only turns a verified
 * `message.received` delivery into a Chat SDK message. The author id is the
 * normalized sender handle — that, not the pool number the person texted, is
 * what `messenger_account_links` routes on.
 */
export class LinqChatAdapter implements Adapter<string, LinqInboundMessage> {
  readonly name = 'linq';

  private readonly api: LinqApiClient;
  private readonly formatConverter = new LinqFormatConverter();

  private _userName = 'linq-bot';
  private chat!: ChatInstance;
  private logger!: Logger;

  constructor(config: LinqChatAdapterConfig) {
    this.api = config.api;
  }

  get botUserId(): string {
    return 'linq:self';
  }

  get userName(): string {
    return this._userName;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();
  }

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    let event: LinqWebhookEvent<LinqInboundMessage>;
    try {
      event = (await request.json()) as LinqWebhookEvent<LinqInboundMessage>;
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const data = event.data;
    if (
      event.event_type !== LINQ_MESSAGE_RECEIVED_EVENT ||
      !data?.id ||
      !data.chat?.id ||
      data.direction === 'outbound'
    ) {
      return Response.json({ ok: true });
    }

    // Group chats with a pool number are out of scope: the shared bot is a
    // one-to-one assistant, and a group would leak one member's agent to all.
    if (data.chat.is_group) {
      this.logger.info('Ignored Linq group message %s', data.id);
      return Response.json({ ok: true });
    }

    if (!linqSenderHandle(data)) {
      this.logger.warn('Ignored Linq message %s without a sender handle', data.id);
      return Response.json({ ok: true });
    }

    const threadId = this.encodeThreadId(data.chat.id);
    this.chat.processMessage(
      this,
      threadId,
      async () => this.parseInbound(data, threadId),
      options,
    );
    return Response.json({ ok: true });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<LinqInboundMessage>> {
    const chatId = this.decodeThreadId(threadId);
    // Linq delivers text verbatim — degrade markdown before it leaves.
    const text = markdownToPlainText(this.formatConverter.renderPostable(message));
    const sent = await this.api.sendText(chatId, text);
    return {
      id: sent.message?.id ?? `local_${Date.now()}`,
      raw: { chat: { id: chatId }, direction: 'outbound', id: sent.message?.id ?? '' },
      threadId,
    };
  }

  /**
   * iMessage cannot edit a delivered bubble through Linq. Posting the edit as
   * a fresh message would spam progress placeholders, so an edit is a no-op
   * that reports the original id; the final reply always arrives as a post.
   */
  async editMessage(
    threadId: string,
    messageId: string,
    _message: AdapterPostableMessage,
  ): Promise<RawMessage<LinqInboundMessage>> {
    return {
      id: messageId,
      raw: { chat: { id: this.decodeThreadId(threadId) }, id: messageId },
      threadId,
    };
  }

  async deleteMessage(): Promise<void> {}

  async addReaction(_threadId: string, _messageId: string, _emoji: EmojiValue | string) {}

  async removeReaction(_threadId: string, _messageId: string, _emoji: EmojiValue | string) {}

  async fetchMessages(): Promise<FetchResult<LinqInboundMessage>> {
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    return { channelId: threadId, id: threadId, isDM: true, metadata: {} };
  }

  async startTyping(threadId: string): Promise<void> {
    try {
      await this.api.startTyping(this.decodeThreadId(threadId));
    } catch (error) {
      this.logger.warn('startTyping failed for %s: %s', threadId, error);
    }
  }

  parseMessage(raw: LinqInboundMessage): Message<LinqInboundMessage> {
    return this.parseInbound(raw, this.encodeThreadId(raw.chat?.id ?? ''));
  }

  encodeThreadId(chatId: string): string {
    return encodeLinqThreadId(chatId);
  }

  decodeThreadId(threadId: string): string {
    return decodeLinqThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(): boolean {
    return true;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private parseInbound(data: LinqInboundMessage, threadId: string): Message<LinqInboundMessage> {
    const text = partsToText(data.parts);
    const userId = linqSenderHandle(data) ?? 'unknown';
    const author: Author = {
      fullName: userId,
      isBot: false,
      isMe: false,
      userId,
      userName: userId,
    };

    return new Message({
      attachments: partsToAttachments(data.parts),
      author,
      formatted: parseMarkdown(text),
      id: data.id,
      metadata: {
        dateSent: data.sent_at ? new Date(data.sent_at) : new Date(),
        edited: false,
      },
      raw: data,
      text,
      threadId,
    });
  }
}
