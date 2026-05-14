import { createHmac, timingSafeEqual } from 'node:crypto';

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

import { WhatsAppApi } from './api';
import { WhatsAppFormatConverter } from './format-converter';
import type {
  WhatsAppAdapterConfig,
  WhatsAppContact,
  WhatsAppMediaObject,
  WhatsAppMessage,
  WhatsAppThreadId,
  WhatsAppWebhookPayload,
  WhatsAppWebhookValue,
} from './types';

export function computeSignature(body: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(body, 'utf8').digest('hex')}`;
}

export function verifySignature(
  body: string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = computeSignature(body, appSecret);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function extractText(message: WhatsAppMessage): string {
  switch (message.type) {
    case 'text': {
      return message.text?.body ?? '';
    }
    case 'button': {
      return message.button?.text ?? message.button?.payload ?? '[button response]';
    }
    case 'interactive': {
      const title =
        message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title;
      const description = message.interactive?.list_reply?.description;
      const parts = [title, description].filter(Boolean).join('\n');
      return parts || '[interactive response]';
    }
    case 'image':
    case 'video':
    case 'document': {
      const media = getMediaObject(message);
      if (media?.caption) return media.caption;
      if (media?.filename) return `[${message.type}: ${media.filename}]`;
      return `[${message.type}]`;
    }
    case 'audio':
    case 'sticker': {
      return `[${message.type}]`;
    }
    case 'location': {
      const location = message.location;
      const label = [location?.name, location?.address].filter(Boolean).join(', ');
      return label ? `[location: ${label}]` : '[location]';
    }
    default: {
      return message.type ? `[unsupported WhatsApp message: ${message.type}]` : '';
    }
  }
}

function getMediaObject(message: WhatsAppMessage): WhatsAppMediaObject | undefined {
  switch (message.type) {
    case 'image': {
      return message.image;
    }
    case 'video': {
      return message.video;
    }
    case 'audio': {
      return message.audio;
    }
    case 'document': {
      return message.document;
    }
    case 'sticker': {
      return message.sticker;
    }
    default: {
      return undefined;
    }
  }
}

function chatAttachmentType(type: string): string {
  switch (type) {
    case 'image':
    case 'video':
    case 'audio': {
      return type;
    }
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
      return 'audio/ogg';
    }
    case 'sticker': {
      return 'image/webp';
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
      return 'audio.ogg';
    }
    case 'sticker': {
      return 'sticker.webp';
    }
    default: {
      return 'file.bin';
    }
  }
}

export function extractMediaMetadata(message: WhatsAppMessage): Attachment[] {
  const media = getMediaObject(message);
  if (!media?.id) return [];

  return [
    {
      mimeType: media.mime_type ?? defaultMimeForType(message.type),
      name: defaultNameForType(message.type, media.filename),
      raw: message,
      type: chatAttachmentType(message.type),
      url: '',
    } as Attachment,
  ];
}

function contactsByWaId(value: WhatsAppWebhookValue): Map<string, WhatsAppContact> {
  const map = new Map<string, WhatsAppContact>();
  for (const contact of value.contacts ?? []) {
    if (contact.wa_id) map.set(contact.wa_id, contact);
  }
  return map;
}

function timestampToDate(timestamp?: string): Date {
  const seconds = timestamp ? Number(timestamp) : NaN;
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

export class WhatsAppAdapter implements Adapter<WhatsAppThreadId, WhatsAppMessage> {
  readonly name = 'whatsapp';

  private readonly api: WhatsAppApi;
  private readonly appSecret: string;
  private readonly formatConverter: WhatsAppFormatConverter;
  private readonly phoneNumberId: string;
  private readonly verifyToken: string;

  private _userName: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  constructor(config: WhatsAppAdapterConfig & { userName?: string }) {
    if (!config.accessToken) throw new Error('WhatsApp adapter requires accessToken');
    if (!config.appSecret) throw new Error('WhatsApp adapter requires appSecret');
    if (!config.phoneNumberId) throw new Error('WhatsApp adapter requires phoneNumberId');
    if (!config.verifyToken) throw new Error('WhatsApp adapter requires verifyToken');

    this.api = new WhatsAppApi({
      accessToken: config.accessToken,
      apiBaseUrl: config.apiBaseUrl,
      graphApiVersion: config.graphApiVersion,
      phoneNumberId: config.phoneNumberId,
    });
    this.appSecret = config.appSecret;
    this.formatConverter = new WhatsAppFormatConverter();
    this.phoneNumberId = config.phoneNumberId;
    this.verifyToken = config.verifyToken;
    this._userName = config.userName || 'whatsapp-bot';
  }

  get userName(): string {
    return this._userName;
  }

  get botUserId(): string {
    return this.phoneNumberId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName();
    this.logger.info('Initialized WhatsApp adapter (phoneNumberId=%s)', this.phoneNumberId);
  }

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    if (request.method === 'GET') return this.handleVerification(request);

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const bodyText = await request.text();
    const signature = request.headers.get('x-hub-signature-256');
    if (!verifySignature(bodyText, signature, this.appSecret)) {
      this.logger.warn('Rejected WhatsApp webhook with invalid X-Hub-Signature-256');
      return new Response('Invalid signature', { status: 401 });
    }

    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        await this.dispatchValue(change.value, options);
      }
    }

    return Response.json({ ok: true });
  }

  private handleVerification(request: Request): Response {
    const url = new URL(request.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === this.verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }

    return new Response('Invalid verify token', { status: 401 });
  }

  private async dispatchValue(
    value: WhatsAppWebhookValue,
    options?: WebhookOptions,
  ): Promise<void> {
    if (value.metadata?.phone_number_id && value.metadata.phone_number_id !== this.phoneNumberId) {
      this.logger.warn(
        'Skipping WhatsApp webhook for phoneNumberId=%s on adapter=%s',
        value.metadata.phone_number_id,
        this.phoneNumberId,
      );
      return;
    }

    const contacts = contactsByWaId(value);
    for (const message of value.messages ?? []) {
      await this.dispatchMessage(message, contacts.get(message.from), options);
    }
  }

  private async dispatchMessage(
    raw: WhatsAppMessage,
    contact?: WhatsAppContact,
    options?: WebhookOptions,
  ): Promise<void> {
    if (!raw.id || !raw.from) return;
    const threadId = this.encodeThreadId({ id: raw.from, type: 'user' });
    const messageFactory = async () => this.parseInbound(raw, threadId, contact);
    await this.chat.processMessage(this, threadId, messageFactory, options);
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WhatsAppMessage>> {
    const { id: to } = this.decodeThreadId(threadId);
    const text = this.formatConverter.renderPostable(message);
    const result = await this.api.sendText(to, text);
    const localId = result.id ?? `local_${Date.now()}`;

    return {
      id: localId,
      raw: {
        from: this.phoneNumberId,
        id: localId,
        text: { body: text },
        type: 'text',
      },
      threadId,
    };
  }

  async editMessage(
    threadId: string,
    _messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WhatsAppMessage>> {
    return this.postMessage(threadId, message);
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    this.logger.warn('Message deletion not supported for WhatsApp Cloud API');
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<WhatsAppMessage>> {
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { id } = this.decodeThreadId(threadId);
    return {
      channelId: id,
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

  parseMessage(raw: WhatsAppMessage, threadId?: string): Message<WhatsAppMessage> {
    return this.parseInbound(
      raw,
      threadId ?? this.encodeThreadId({ id: raw.from || this.phoneNumberId, type: 'user' }),
    );
  }

  private parseInbound(
    raw: WhatsAppMessage,
    threadId: string,
    contact?: WhatsAppContact,
  ): Message<WhatsAppMessage> {
    const text = extractText(raw);
    const authorUserId = raw.from;
    const displayName = contact?.profile?.name || authorUserId;
    const author: Author = {
      fullName: displayName,
      isBot: false,
      isMe: false,
      userId: authorUserId,
      userName: displayName,
    };

    return new Message({
      attachments: extractMediaMetadata(raw),
      author,
      formatted: parseMarkdown(text),
      id: raw.id,
      metadata: {
        dateSent: timestampToDate(raw.timestamp),
        edited: false,
      },
      raw,
      text,
      threadId,
    });
  }

  encodeThreadId(data: WhatsAppThreadId): string {
    return `whatsapp:${data.type}:${data.id}`;
  }

  decodeThreadId(threadId: string): WhatsAppThreadId {
    const parts = threadId.split(':');
    if (parts.length < 3 || parts[0] !== 'whatsapp') {
      return { id: threadId, type: 'user' };
    }
    return { id: parts.slice(2).join(':'), type: 'user' };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).id;
  }

  isDM(_threadId: string): boolean {
    return true;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

export function createWhatsAppAdapter(
  config: WhatsAppAdapterConfig & { userName?: string },
): WhatsAppAdapter {
  return new WhatsAppAdapter(config);
}

export function resolveMediaId(raw: WhatsAppMessage | undefined): string | undefined {
  return raw ? getMediaObject(raw)?.id : undefined;
}

export function getMediaNameAndType(raw: WhatsAppMessage | undefined): {
  fileName?: string;
  mimeType?: string;
  type?: string;
} {
  if (!raw) return {};
  const media = getMediaObject(raw);
  return {
    fileName: media?.filename,
    mimeType: media?.mime_type,
    type: raw.type,
  };
}
