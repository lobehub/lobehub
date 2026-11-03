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

import { BlueBubblesApiClient, resolveAttachmentName } from './api';
import { ImessageFormatConverter } from './format-converter';
import type {
  BlueBubblesAttachment,
  BlueBubblesChat,
  BlueBubblesMessage,
  BlueBubblesWebhookEvent,
  ImessageAdapterConfig,
  ImessageBridgeTransport,
  ImessageThreadId,
} from './types';

const NEW_MESSAGE_EVENT = 'new-message';

function senderIdFromMessage(message: BlueBubblesMessage): string {
  const handle = message.handle;
  return (
    handle?.address ||
    handle?.uncanonicalizedId ||
    String(message.handleId ?? message.otherHandle ?? 'unknown')
  );
}

function extractText(message: BlueBubblesMessage): string {
  const text = message.text?.trim();
  if (text) return text;

  const subject = message.subject?.trim();
  if (subject) return subject;

  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return '';
  return attachments
    .map((attachment) => {
      const name = resolveAttachmentName(attachment);
      return `[attachment: ${name}]`;
    })
    .join('\n');
}

function attachmentType(mimeType: string | undefined): 'audio' | 'file' | 'image' | 'video' {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  return 'file';
}

export function extractAttachmentMetadata(message: BlueBubblesMessage): Attachment[] {
  return (message.attachments ?? []).map((attachment) => ({
    mimeType: attachment.mimeType ?? 'application/octet-stream',
    name: resolveAttachmentName(attachment),
    raw: attachment,
    size: attachment.totalBytes,
    type: attachmentType(attachment.mimeType),
    url: '',
  })) as Attachment[];
}

function dateFromBlueBubbles(timestamp: number | null | undefined): Date {
  if (!timestamp) return new Date();
  return new Date(timestamp);
}

function isDirectChat(chat: BlueBubblesChat | undefined): boolean {
  if (!chat) return false;
  if (typeof chat.style === 'number') return chat.style !== 43;
  if (Array.isArray(chat.participants)) return chat.participants.length <= 1;
  return false;
}

export function encodeImessageThreadId(data: ImessageThreadId): string {
  return `imessage:${data.chatGuid}`;
}

export function decodeImessageThreadId(threadId: string): ImessageThreadId {
  if (threadId.startsWith('imessage:')) {
    return { chatGuid: threadId.slice('imessage:'.length) };
  }
  return { chatGuid: threadId };
}

export class ImessageAdapter implements Adapter<ImessageThreadId, BlueBubblesMessage> {
  readonly name = 'imessage';

  private readonly api?: BlueBubblesApiClient;
  private readonly botId: string;
  private readonly formatConverter: ImessageFormatConverter;
  private readonly knownDmThreads = new Map<string, boolean>();
  private readonly transport?: ImessageBridgeTransport;
  private readonly webhookSecret: string;

  private _userName: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  constructor(config: ImessageAdapterConfig) {
    if (!config.webhookSecret?.trim()) throw new Error('iMessage adapter requires webhookSecret');

    if (config.transport) {
      this.transport = config.transport;
    } else {
      if (!config.serverUrl?.trim()) throw new Error('iMessage adapter requires serverUrl');
      if (!config.password?.trim()) throw new Error('iMessage adapter requires password');
      this.api = new BlueBubblesApiClient({
        password: config.password,
        requestTimeoutMs: config.requestTimeoutMs,
        serverUrl: config.serverUrl,
      });
    }
    this.webhookSecret = config.webhookSecret;
    this.botId = config.botUserId || 'imessage:self';
    this._userName = config.userName || 'imessage-bot';
    this.formatConverter = new ImessageFormatConverter();
  }

  get botUserId(): string {
    return this.botId;
  }

  get userName(): string {
    return this._userName;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();
    this.logger.info(
      this.transport
        ? 'Initialized iMessage adapter via Desktop BlueBubbles bridge'
        : 'Initialized iMessage adapter via BlueBubbles',
    );
  }

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.searchParams.get('secret') !== this.webhookSecret) {
      this.logger.warn('Rejected iMessage webhook with invalid secret');
      return new Response('Invalid secret', { status: 401 });
    }

    let event: BlueBubblesWebhookEvent;
    try {
      event = (await request.json()) as BlueBubblesWebhookEvent;
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (event.type !== NEW_MESSAGE_EVENT) {
      return Response.json({ ok: true });
    }

    const message = await this.resolveWebhookMessage(event.data);
    if (!message?.guid) {
      this.logger.warn('Ignored iMessage webhook without message guid');
      return Response.json({ ok: true });
    }

    if (message.isFromMe) {
      return Response.json({ ok: true });
    }

    const chat = message.chats?.[0];
    const chatGuid = chat?.guid;
    if (!chatGuid) {
      this.logger.warn('Ignored iMessage webhook without chat guid for message=%s', message.guid);
      return Response.json({ ok: true });
    }

    const threadId = this.encodeThreadId({ chatGuid });
    this.knownDmThreads.set(threadId, isDirectChat(chat));
    const messageFactory = async () => this.parseInbound(message, threadId);
    this.chat.processMessage(this, threadId, messageFactory, options);

    return Response.json({ ok: true });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<BlueBubblesMessage>> {
    const { chatGuid } = this.decodeThreadId(threadId);
    const text = this.formatConverter.renderPostable(message);
    const raw = this.transport?.sendText
      ? await this.transport.sendText(chatGuid, text)
      : await this.getApi().sendText(chatGuid, text);
    return {
      id: raw.guid || raw.tempGuid || `local_${Date.now()}`,
      raw,
      threadId,
    };
  }

  async editMessage(
    threadId: string,
    _messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<BlueBubblesMessage>> {
    return this.postMessage(threadId, message);
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    this.logger.warn('Message deletion not supported for iMessage via BlueBubbles');
  }

  async fetchMessages(
    threadId: string,
    options?: FetchOptions,
  ): Promise<FetchResult<BlueBubblesMessage>> {
    const { chatGuid } = this.decodeThreadId(threadId);
    const result = this.transport?.getChatMessages
      ? await this.transport.getChatMessages(chatGuid, {
          limit: options?.limit,
          sort: 'DESC',
          withParts: ['attachments'],
        })
      : await this.getApi().getChatMessages(chatGuid, {
          limit: options?.limit,
          sort: 'DESC',
          withParts: ['attachments'],
        });
    return {
      messages: result.data.map((raw) => this.parseInbound(raw, threadId)).reverse(),
      nextCursor: undefined,
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatGuid } = this.decodeThreadId(threadId);
    try {
      const chat = this.transport?.getChat
        ? await this.transport.getChat(chatGuid, ['participants'])
        : await this.getApi().getChat(chatGuid, ['participants']);
      const isDM = isDirectChat(chat);
      this.knownDmThreads.set(threadId, isDM);
      return {
        channelId: threadId,
        channelName: chat.displayName || chat.chatIdentifier,
        id: threadId,
        isDM,
        metadata: chat as unknown as Record<string, unknown>,
      };
    } catch (error) {
      this.logger.warn('fetchThread failed for %s: %s', threadId, error);
      return {
        channelId: threadId,
        id: threadId,
        isDM: this.knownDmThreads.get(threadId) ?? false,
        metadata: { chatGuid },
      };
    }
  }

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
    const { chatGuid } = this.decodeThreadId(threadId);
    try {
      if (this.transport?.startTyping) {
        await this.transport.startTyping(chatGuid);
      } else {
        await this.getApi().startTyping(chatGuid);
      }
    } catch (error) {
      this.logger.warn('startTyping failed for %s: %s', threadId, error);
    }
  }

  parseMessage(raw: BlueBubblesMessage, threadId?: string): Message<BlueBubblesMessage> {
    return this.parseInbound(
      raw,
      threadId ?? this.encodeThreadId({ chatGuid: raw.chats?.[0]?.guid ?? this.botId }),
    );
  }

  encodeThreadId(data: ImessageThreadId): string {
    return encodeImessageThreadId(data);
  }

  decodeThreadId(threadId: string): ImessageThreadId {
    return decodeImessageThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(threadId: string): boolean {
    return this.knownDmThreads.get(threadId) ?? false;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private async resolveWebhookMessage(
    message: BlueBubblesMessage | undefined,
  ): Promise<BlueBubblesMessage | undefined> {
    if (!message?.guid) return message;
    if (message.chats?.[0]?.guid) return message;

    if (!this.api) {
      this.logger.warn(
        'iMessage bridge webhook message=%s did not include chat data; configure Desktop bridge enrichment',
        message.guid,
      );
      return message;
    }

    try {
      return await this.api.getMessage(message.guid, ['chats', 'attachments']);
    } catch (error) {
      this.logger.warn('Failed to enrich iMessage webhook message=%s: %s', message.guid, error);
      return message;
    }
  }

  private getApi(): BlueBubblesApiClient {
    if (!this.api) throw new Error('BlueBubbles API is not available in Desktop bridge mode');
    return this.api;
  }

  private parseInbound(message: BlueBubblesMessage, threadId: string): Message<BlueBubblesMessage> {
    const text = extractText(message);
    const formatted = parseMarkdown(text);
    const userId = message.isFromMe ? this.botId : senderIdFromMessage(message);
    const author: Author = {
      fullName: userId,
      isBot: Boolean(message.isFromMe),
      isMe: Boolean(message.isFromMe),
      userId,
      userName: userId,
    };

    return new Message({
      attachments: extractAttachmentMetadata(message),
      author,
      formatted,
      id: message.guid,
      metadata: {
        dateSent: dateFromBlueBubbles(message.dateCreated),
        edited: false,
      },
      raw: message,
      text,
      threadId,
    });
  }
}

export function createImessageAdapter(config: ImessageAdapterConfig): ImessageAdapter {
  return new ImessageAdapter(config);
}

export function resolveAttachmentGuid(raw: BlueBubblesAttachment | undefined): string | undefined {
  return raw?.guid;
}
