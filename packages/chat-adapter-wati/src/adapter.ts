import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from 'chat';
import { Message, parseMarkdown } from 'chat';

import { verifyWebhookSignature, WatiApiClient } from './api';
import type { WatiAdapterConfig, WatiInboundMessage, WatiRawMessage, WatiThreadId } from './types';

const INBOUND_MESSAGE_EVENT = 'message';

function extractInboundText(payload: WatiInboundMessage): string {
  if (payload.type === 'text' && payload.text?.trim()) {
    return payload.text.trim();
  }

  switch (payload.type) {
    case 'image': {
      return '[image]';
    }
    case 'video': {
      return '[video]';
    }
    case 'audio':
    case 'voice': {
      return '[audio]';
    }
    case 'document': {
      return '[document]';
    }
    case 'location': {
      return '[location]';
    }
    case 'sticker': {
      return '[sticker]';
    }
    case 'interactive':
    case 'button': {
      return payload.text?.trim() || '[interactive message]';
    }
    default: {
      return payload.text?.trim() || '';
    }
  }
}

function isCustomerMessage(payload: WatiInboundMessage): boolean {
  if (payload.eventType && payload.eventType !== INBOUND_MESSAGE_EVENT) return false;
  if (payload.owner === true) return false;
  if (!payload.waId?.trim()) return false;
  return true;
}

/**
 * Wati WhatsApp adapter for Chat SDK.
 *
 * Inbound: Wati dashboard webhooks (`eventType: "message"`, `owner: false`).
 * Outbound: Wati `sendSessionMessage` REST API (session / 24h window).
 */
export class WatiAdapter implements Adapter<WatiThreadId, WatiRawMessage> {
  readonly name = 'wati';

  private readonly api: WatiApiClient;
  private readonly channelPhoneNumber: string;
  private readonly webhookSecret?: string;

  private _userName: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  constructor(config: WatiAdapterConfig & { userName?: string }) {
    if (!config.apiBaseUrl) throw new Error('Wati adapter requires apiBaseUrl');
    if (!config.bearerToken) throw new Error('Wati adapter requires bearerToken');
    if (!config.tenantId) throw new Error('Wati adapter requires tenantId');
    if (!config.channelPhoneNumber) throw new Error('Wati adapter requires channelPhoneNumber');

    this.api = new WatiApiClient({
      apiBaseUrl: config.apiBaseUrl,
      bearerToken: config.bearerToken,
      tenantId: config.tenantId,
    });
    this.channelPhoneNumber = config.channelPhoneNumber.replaceAll(/\D/g, '');
    this.webhookSecret = config.webhookSecret?.trim() || undefined;
    this._userName = config.userName || 'wati-bot';
  }

  get userName(): string {
    return this._userName;
  }

  get botUserId(): string {
    return this.channelPhoneNumber;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();
    this.logger.info(
      'Initialized Wati adapter (channel=%s, tenant=%s)',
      this.channelPhoneNumber,
      this.api.tenantId,
    );
  }

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const bodyText = await request.text();

    if (this.webhookSecret) {
      const signature =
        request.headers.get('x-wati-signature') ??
        request.headers.get('x-hub-signature-256') ??
        request.headers.get('x-hub-signature');
      if (!verifyWebhookSignature(bodyText, signature, this.webhookSecret)) {
        this.logger.warn('Rejected Wati webhook with invalid signature');
        return new Response('Invalid signature', { status: 401 });
      }
    }

    let payload: WatiInboundMessage;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (!isCustomerMessage(payload)) {
      return Response.json({ ok: true });
    }

    const inboundChannel = payload.channelPhoneNumber?.replaceAll(/\D/g, '');
    if (inboundChannel && inboundChannel !== this.channelPhoneNumber) {
      this.logger.debug(
        'Ignoring Wati message for channel %s (expected %s)',
        inboundChannel,
        this.channelPhoneNumber,
      );
      return Response.json({ ok: true });
    }

    await this.dispatchInbound(payload, options);
    return Response.json({ ok: true });
  }

  private async dispatchInbound(
    payload: WatiInboundMessage,
    options?: WebhookOptions,
  ): Promise<void> {
    const waId = payload.waId!.trim();
    const threadId = this.encodeThreadId({ id: waId, type: 'user' });
    const messageFactory = async () => this.parseInbound(payload, threadId);
    this.chat.processMessage(this, threadId, messageFactory, options);
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WatiRawMessage>> {
    const { id: whatsappNumber } = this.decodeThreadId(threadId);
    const text = typeof message === 'string' ? message : (message.text ?? '');
    if (text.trim()) {
      await this.api.sendSessionMessage(whatsappNumber, text, {
        channelPhoneNumber: this.channelPhoneNumber,
      });
    }

    const localId = `local_${Date.now()}`;
    return {
      id: localId,
      raw: {
        eventType: 'sessionMessageSent_v2',
        id: localId,
        text,
        type: 'text',
        waId: whatsappNumber,
      },
      threadId,
    };
  }

  async editMessage(
    threadId: string,
    _messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WatiRawMessage>> {
    return this.postMessage(threadId, message);
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {}

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<WatiRawMessage>> {
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { id } = this.decodeThreadId(threadId);
    return {
      channelId: threadId,
      id: threadId,
      isDM: true,
      metadata: { id, type: 'user' },
    };
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

  async startTyping(_threadId: string): Promise<void> {}

  parseInbound(payload: WatiInboundMessage, threadId: string): Message<WatiRawMessage> {
    const text = extractInboundText(payload);
    const formatted = parseMarkdown(text);
    const messageId = payload.whatsappMessageId || payload.id || `wati_${Date.now()}`;

    const author: Author = {
      fullName: payload.senderName || payload.waId || 'user',
      isBot: false,
      isMe: false,
      userId: payload.waId || 'unknown',
      userName: payload.senderName || payload.waId || 'user',
    };

    const ts = payload.timestamp ? Number(payload.timestamp) * 1000 : Date.now();

    return new Message({
      author,
      formatted,
      id: messageId,
      metadata: {
        dateSent: new Date(Number.isFinite(ts) ? ts : Date.now()),
        edited: false,
      },
      raw: payload,
      text,
      threadId,
    });
  }

  encodeThreadId(data: WatiThreadId): string {
    return `wati:user:${data.id}`;
  }

  decodeThreadId(threadId: string): WatiThreadId {
    const parts = threadId.split(':');
    if (parts.length >= 3 && parts[0] === 'wati' && parts[1] === 'user') {
      return { id: parts.slice(2).join(':'), type: 'user' };
    }
    return { id: threadId, type: 'user' };
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(_threadId: string): boolean {
    return true;
  }

  renderFormatted(content: { text: string }): string {
    return content.text;
  }
}

export function createWatiAdapter(config: WatiAdapterConfig & { userName?: string }): WatiAdapter {
  return new WatiAdapter(config);
}
