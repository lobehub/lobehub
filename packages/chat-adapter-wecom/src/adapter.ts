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
import { Message, parseMarkdown } from 'chat';

import { threadFromBody } from './connection';
import { verifyForwardedFrame, WECOM_SIGNATURE_HEADER, WECOM_TIMESTAMP_HEADER } from './crypto';
import { WeComFormatConverter } from './format-converter';
import { collectWeComMedia, downloadWeComMedia } from './media';
import { getWeComConnection, requireWeComConnection } from './registry';
import type {
  WeComAdapterConfig,
  WeComForwardedFrame,
  WeComMessageBody,
  WeComQuote,
  WeComRawMessage,
  WeComThreadId,
} from './types';
import { WECOM_CMD } from './types';

const quoteText = (quote?: WeComQuote): string | undefined => {
  if (!quote) return undefined;
  switch (quote.msgtype) {
    case 'text': {
      return quote.text?.content;
    }
    case 'voice': {
      return quote.voice?.content;
    }
    case 'mixed': {
      return quote.mixed?.msg_item
        .map((item) => (item.msgtype === 'text' ? item.text?.content : undefined))
        .filter(Boolean)
        .join('\n');
    }
    default: {
      return undefined;
    }
  }
};

/** The text a message carries: typed text, transcribed voice, or the text parts of a mixed one. */
export const extractWeComText = (body: WeComMessageBody): string => {
  switch (body.msgtype) {
    case 'text': {
      return body.text?.content ?? '';
    }
    case 'voice': {
      return body.voice?.content ?? '';
    }
    case 'mixed': {
      return (body.mixed?.msg_item ?? [])
        .map((item) => (item.msgtype === 'text' ? (item.text?.content ?? '') : ''))
        .filter(Boolean)
        .join('\n');
    }
    default: {
      return '';
    }
  }
};

export class WeComAdapter implements Adapter<WeComThreadId, WeComRawMessage> {
  readonly name = 'wecom';

  private readonly botId: string;
  private readonly secret: string;
  private readonly formatConverter = new WeComFormatConverter();
  private _userName: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  constructor(config: WeComAdapterConfig) {
    this.botId = config.botId;
    this.secret = config.secret;
    this._userName = config.userName || 'wecom-bot';
  }

  get userName(): string {
    return this._userName;
  }

  get botUserId(): string {
    return this.botId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();
  }

  // ------------------------------------------------------------------
  // Inbound — frames forwarded by the long connection
  // ------------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const bodyText = await request.text();

    if (
      !verifyForwardedFrame(
        this.secret,
        request.headers.get(WECOM_TIMESTAMP_HEADER),
        request.headers.get(WECOM_SIGNATURE_HEADER),
        bodyText,
      )
    ) {
      return new Response('Invalid signature', { status: 401 });
    }

    let frame: WeComForwardedFrame;
    try {
      frame = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (frame.cmd !== WECOM_CMD.MSG_CALLBACK || !frame.body) {
      return Response.json({ ok: true });
    }

    const body = frame.body;
    if (body.aibotid && body.aibotid !== this.botId) {
      return Response.json({ ok: true });
    }

    const thread = threadFromBody(body);
    if (!thread) return Response.json({ ok: true });

    const text = extractWeComText(body).trim();
    if (!text && collectWeComMedia(body).length === 0) {
      return Response.json({ ok: true });
    }

    const threadId = this.encodeThreadId(thread);
    const raw: WeComRawMessage = { body, reqId: frame.headers?.req_id ?? '' };
    this.chat.processMessage(this, threadId, async () => this.parseMessage(raw), options);

    return Response.json({ ok: true });
  }

  // ------------------------------------------------------------------
  // Outbound — over the live connection
  // ------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WeComRawMessage>> {
    const thread = this.decodeThreadId(threadId);
    const text = this.formatConverter.renderPostable(message);
    const result = await requireWeComConnection(this.botId).deliver(thread, text);

    return {
      id: result.id,
      raw: {
        body: {
          aibotid: this.botId,
          chatid: thread.type === 'group' ? thread.id : undefined,
          chattype: thread.type,
          from: { userid: this.botId },
          msgid: result.id,
          msgtype: 'markdown',
          text: { content: text },
        },
        reqId: '',
      },
      threadId,
    };
  }

  /** A sent WeCom message cannot be changed; an edit goes out as a new message (like QQ). */
  async editMessage(
    threadId: string,
    _messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WeComRawMessage>> {
    return this.postMessage(threadId, message);
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    // AI bots cannot recall messages.
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<WeComRawMessage>> {
    // No history API for AI bots.
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { id, type } = this.decodeThreadId(threadId);
    return { channelId: threadId, id: threadId, isDM: type === 'single', metadata: { id, type } };
  }

  /**
   * WeCom has no typing indicator; the closest is a stream bubble opened on the message being
   * answered, which the reply then fills and finishes. Best-effort: a missing connection or a
   * refused frame just means no bubble.
   */
  async startTyping(threadId: string): Promise<void> {
    const connection = getWeComConnection(this.botId);
    if (!connection?.isConnected) return;
    try {
      await connection.openStream(this.decodeThreadId(threadId));
    } catch (error) {
      this.logger?.warn('WeCom startTyping failed: %O', error);
    }
  }

  async addReaction(_threadId: string, _messageId: string, _emoji: EmojiValue | string) {
    // AI bots have no reactions.
  }

  async removeReaction(_threadId: string, _messageId: string, _emoji: EmojiValue | string) {
    // AI bots have no reactions.
  }

  // ------------------------------------------------------------------
  // Parsing
  // ------------------------------------------------------------------

  parseMessage(raw: WeComRawMessage): Message<WeComRawMessage> {
    const { body } = raw;
    const thread = threadFromBody(body) ?? { id: body.from?.userid ?? '', type: 'single' };
    const isGroup = thread.type === 'group';

    let text = extractWeComText(body);
    if (isGroup) text = this.formatConverter.stripLeadingMention(text);
    const quoted = quoteText(body.quote)?.trim();
    if (quoted) text = `${quoted.replaceAll(/^/gm, '> ')}\n\n${text}`.trim();

    const userId = body.from?.userid ?? 'unknown';
    const message = new Message<WeComRawMessage>({
      attachments: this.mapAttachments(body),
      author: { fullName: userId, isBot: false, isMe: false, userId, userName: userId },
      formatted: parseMarkdown(text),
      id: body.msgid,
      metadata: {
        dateSent: new Date(body.create_time ? body.create_time * 1000 : Date.now()),
        edited: false,
      },
      raw,
      text,
      threadId: this.encodeThreadId(thread),
    });
    // WeCom only delivers group messages that @-mention the bot.
    if (isGroup) message.isMention = true;
    return message;
  }

  private mapAttachments(body: WeComMessageBody): Attachment[] {
    return collectWeComMedia(body).map(
      (ref) =>
        ({
          fetchData: async () => (await downloadWeComMedia(ref)).buffer,
          type: ref.kind,
          url: ref.url,
        }) as Attachment,
    );
  }

  // ------------------------------------------------------------------
  // Thread IDs — `wecom:single:<userid>` / `wecom:group:<chatid>`
  // ------------------------------------------------------------------

  encodeThreadId(data: WeComThreadId): string {
    return `wecom:${data.type}:${data.id}`;
  }

  decodeThreadId(threadId: string): WeComThreadId {
    const [prefix, type, ...rest] = threadId.split(':');
    if (prefix !== 'wecom' || (type !== 'single' && type !== 'group') || rest.length === 0) {
      throw new Error(`Invalid WeCom thread id: ${threadId}`);
    }
    return { id: rest.join(':'), type };
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).type === 'single';
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

export function createWeComAdapter(config: WeComAdapterConfig): WeComAdapter {
  return new WeComAdapter(config);
}
