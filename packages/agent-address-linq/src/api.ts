import type {
  LinqApiConfig,
  LinqAttachmentCreateResponse,
  LinqChat,
  LinqChatCreateResponse,
  LinqChatListResponse,
  LinqMessageContent,
  LinqMessagePart,
  LinqMessageSendResponse,
  LinqOutboundAttachment,
  LinqSendOptions,
} from './types';
import { LINQ_DEFAULT_BASE_URL } from './types';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Linq caps a single message at 100 parts; consecutive text parts are invalid. */
export const LINQ_MAX_PARTS = 100;

/** URL-sourced media (downloaded by Linq on send) is capped at 10MB. */
export const LINQ_URL_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

interface RequestOptions {
  body?: FormData | Record<string, unknown> | Uint8Array;
  headers?: Record<string, string>;
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT';
  query?: Record<string, boolean | number | string | undefined>;
  signal?: AbortSignal;
}

/**
 * Thin, dependency-free client for Linq's REST v3 API.
 *
 * Used by the paths that must stay off the chat-SDK router (proactive push,
 * link notifications, typing) and by the adapter wrapper's `stopTyping`, which
 * the chat SDK has no hook for. Inbound dispatch reuses the official
 * `@linqapp/chat-sdk-adapter` instead of this client.
 */
export class LinqApiClient {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fromNumber?: string;
  readonly requestTimeoutMs: number;

  constructor(options: LinqApiConfig) {
    if (!options.apiKey?.trim()) throw new Error('Linq apiKey is required');
    this.apiKey = options.apiKey.trim();
    this.baseUrl = stripTrailingSlashes(options.baseUrl?.trim() || LINQ_DEFAULT_BASE_URL);
    this.fromNumber = options.fromNumber?.trim() || undefined;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  /** Cheap authenticated round-trip used to validate a key. */
  async ping(): Promise<void> {
    await this.request('phone_numbers', { query: { limit: 1 } });
  }

  // -------------------------------------------------------------------------
  // Chats & messages
  // -------------------------------------------------------------------------

  /** `GET /chats` — optionally filtered to one participant handle. */
  async listChats(
    options: { cursor?: string; limit?: number; to?: string } = {},
  ): Promise<LinqChatListResponse> {
    const payload = await this.request<LinqChatListResponse & { data?: LinqChat[] }>('chats', {
      query: { cursor: options.cursor, limit: options.limit, to: options.to },
    });
    return { chats: payload?.chats ?? payload?.data ?? [], next_cursor: payload?.next_cursor };
  }

  /** Most recent chat with `handle`, or undefined when LobeHub has never talked to it. */
  async findChat(handle: string): Promise<LinqChat | undefined> {
    const payload = await this.listChats({ limit: 1, to: handle });
    return payload.chats?.[0];
  }

  /**
   * `POST /chats` — opens a chat AND sends the first message. To message a
   * handle LobeHub has not talked to yet, the parts belong here: Linq has no
   * "create an empty chat" shape.
   */
  async createChat(params: {
    from?: string;
    parts: LinqMessagePart[];
    to: string;
    idempotencyKey?: string;
  }): Promise<LinqChatCreateResponse> {
    const from = params.from?.trim() || this.fromNumber;
    if (!from) throw new Error('Linq createChat requires a from number (LINQ_FROM_NUMBER)');

    return this.request<LinqChatCreateResponse>('chats', {
      body: {
        from,
        message: withIdempotency({ parts: params.parts }, params.idempotencyKey),
        to: [params.to],
      },
      method: 'POST',
    });
  }

  /** `POST /chats/{chatId}/messages`. */
  async sendMessage(
    chatId: string,
    parts: LinqMessagePart[],
    options: LinqSendOptions = {},
  ): Promise<LinqMessageSendResponse> {
    assertSendableParts(parts);
    return this.request<LinqMessageSendResponse>(`chats/${encodeURIComponent(chatId)}/messages`, {
      body: { message: withIdempotency({ parts }, options.idempotencyKey) },
      method: 'POST',
    });
  }

  /** Convenience wrapper for the single-text-part case. */
  async sendText(
    chatId: string,
    text: string,
    options: LinqSendOptions = {},
  ): Promise<LinqMessageSendResponse> {
    return this.sendMessage(chatId, [{ type: 'text', value: text }], options);
  }

  /**
   * `POST /chats/{chatId}/messages` for a chat that may not exist yet.
   *
   * Linq needs a chat id to send into, and opening a chat requires the first
   * message. So: reuse the existing chat when there is one, otherwise open the
   * chat with these very parts.
   */
  async sendToHandle(params: {
    attachment?: LinqOutboundAttachment;
    handle: string;
    options?: LinqSendOptions;
    parts?: LinqMessagePart[];
    text?: string;
  }): Promise<{ chatId: string; message?: LinqMessageSendResponse['message'] }> {
    const parts: LinqMessagePart[] = [...(params.parts ?? [])];
    if (params.text) parts.unshift({ type: 'text', value: params.text });
    if (params.attachment) {
      parts.push({
        type: 'media',
        attachment_id: await this.uploadAttachment(params.attachment),
      });
    }
    if (parts.length === 0) throw new Error('sendToHandle requires text, parts or an attachment');
    assertSendableParts(parts);

    const existing = await this.findChat(params.handle);
    if (existing) {
      const sent = await this.sendMessage(existing.id, parts, params.options ?? {});
      return { chatId: existing.id, message: sent.message };
    }

    const created = await this.createChat({
      idempotencyKey: params.options?.idempotencyKey,
      parts,
      to: params.handle,
    });
    return { chatId: created.chat.id };
  }

  // -------------------------------------------------------------------------
  // Typing & read receipts
  // -------------------------------------------------------------------------

  /** `POST /chats/{chatId}/typing` — shows the indicator for ~85s. */
  async startTyping(chatId: string): Promise<void> {
    await this.request(`chats/${encodeURIComponent(chatId)}/typing`, { method: 'POST' });
  }

  /**
   * `DELETE /chats/{chatId}/typing` — clears the indicator immediately.
   *
   * The official chat-SDK adapter exposes `startTyping` only (the chat SDK
   * adapter contract has no stop hook); this is the补齐 half.
   */
  async stopTyping(chatId: string): Promise<void> {
    await this.request(`chats/${encodeURIComponent(chatId)}/typing`, { method: 'DELETE' });
  }

  /** `POST /chats/{chatId}/read` — marks every message in the chat as read. */
  async markRead(chatId: string): Promise<void> {
    await this.request(`chats/${encodeURIComponent(chatId)}/read`, { method: 'POST' });
  }

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  /** Step 1 of the pre-upload flow: ask Linq for a presigned PUT. */
  async createAttachment(input: {
    contentType: string;
    filename: string;
    sizeBytes: number;
  }): Promise<LinqAttachmentCreateResponse> {
    return this.request<LinqAttachmentCreateResponse>('attachments', {
      body: {
        content_type: input.contentType,
        filename: input.filename,
        size_bytes: input.sizeBytes,
      },
      method: 'POST',
    });
  }

  /**
   * Steps 1+2 of the pre-upload flow. Returns the reusable `attachment_id`.
   *
   * `attachment_id` (not a public URL) is what a media part references, which
   * is also how files over 10MB get in — URL-based media is capped there.
   */
  async uploadAttachment(attachment: LinqOutboundAttachment): Promise<string> {
    const bytes = await resolveAttachmentBytes(attachment, this.requestTimeoutMs);
    const mimeType = bytes.mimeType ?? attachment.mimeType ?? 'application/octet-stream';
    const filename = attachment.name?.trim() || inferFileName(mimeType);

    const created = await this.createAttachment({
      contentType: mimeType,
      filename,
      sizeBytes: bytes.buffer.byteLength,
    });

    const uploadUrl = created.upload_url;
    if (!uploadUrl) throw new Error('Linq attachment create returned no upload_url');

    await this.putBytes(uploadUrl, created.required_headers ?? {}, bytes.buffer);
    return created.attachment_id;
  }

  private async putBytes(
    uploadUrl: string,
    headers: Record<string, string>,
    buffer: Uint8Array,
  ): Promise<void> {
    const response = await fetchWithTimeout(
      uploadUrl,
      {
        body: toArrayBuffer(buffer),
        headers,
        method: 'PUT',
      },
      this.requestTimeoutMs,
    );

    if (!response.ok) {
      const detail = await safeReadError(response);
      throw new Error(detail || `Linq attachment upload failed with HTTP ${response.status}`);
    }
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { body, headers, method = 'GET', query, signal } = options;
    const url = this.buildUrl(path, query);
    const init: RequestInit = {
      headers: { Authorization: `Bearer ${this.apiKey}`, ...headers },
      method,
      signal,
    };

    if (body instanceof FormData) {
      init.body = body;
    } else if (body instanceof Uint8Array) {
      // `fetch` accepts ArrayBuffer, not a typed-array view; slice out just the
      // bytes this view covers so a pooled Buffer never leaks its neighbours.
      init.body = toArrayBuffer(body);
    } else if (body) {
      init.body = JSON.stringify(body);
      init.headers = {
        ...(init.headers as Record<string, string>),
        'Content-Type': 'application/json',
      };
    }

    const response = await fetchWithTimeout(url, init, this.requestTimeoutMs);
    return parseResponse<T>(response, `${method} ${path}`);
  }

  private buildUrl(
    path: string,
    query?: Record<string, boolean | number | string | undefined>,
  ): string {
    const url = new URL(path.replace(/^\/+/, ''), `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}

/**
 * Linq rejects consecutive text parts, so a caller that concatenates two text
 * legs must merge them instead of emitting `[text, text]`.
 */
export const assertSendableParts = (parts: LinqMessagePart[]): void => {
  if (parts.length === 0) throw new Error('Linq message requires at least one part');
  if (parts.length > LINQ_MAX_PARTS) {
    throw new Error(`Linq message exceeds ${LINQ_MAX_PARTS} parts (${parts.length})`);
  }
  for (let index = 1; index < parts.length; index++) {
    if (parts[index].type === 'text' && parts[index - 1].type === 'text') {
      throw new Error('Linq rejects consecutive text parts — merge them into one part');
    }
  }
};

const withIdempotency = (
  message: LinqMessageContent,
  idempotencyKey: string | undefined,
): Record<string, unknown> => {
  const payload = { ...message } as Record<string, unknown>;
  if (idempotencyKey) payload.idempotency_key = idempotencyKey;
  return payload;
};

/** `fetch` wants an ArrayBuffer, and a view may be a window onto a pooled Buffer. */
const toArrayBuffer = (view: Uint8Array): ArrayBuffer =>
  view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;

async function parseResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  if (response.status === 204 || !text) {
    if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
    return {} as T;
  }

  const payload = parseJson<T>(text);
  if (!response.ok) {
    const detail = readLinqError(payload) ?? text;
    throw new Error(detail || `${label} failed with HTTP ${response.status}`);
  }
  return (payload ?? ({} as T)) as T;
}

async function safeReadError(response: Response): Promise<string | undefined> {
  const text = await response.text();
  if (!text) return undefined;
  return readLinqError(parseJson(text)) ?? text;
}

function readLinqError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, any>;
  const error = record.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const code = error.code ?? record.code;
    const message = error.message ?? record.message;
    if (message) return code ? `${message} (${code})` : String(message);
  }
  if (typeof record.message === 'string') return record.message;
  return undefined;
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal;

  try {
    return await fetch(url, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }
}

function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

async function resolveAttachmentBytes(
  attachment: LinqOutboundAttachment,
  requestTimeoutMs: number,
): Promise<{ buffer: Uint8Array; mimeType?: string }> {
  if (attachment.data) {
    const buffer = Buffer.from(attachment.data, 'base64');
    return {
      buffer: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      mimeType: attachment.mimeType,
    };
  }

  if (!attachment.fetchUrl) {
    throw new Error('Linq attachment requires either data or fetchUrl');
  }

  const response = await fetchWithTimeout(attachment.fetchUrl, { method: 'GET' }, requestTimeoutMs);
  if (!response.ok) {
    throw new Error(`Failed to fetch attachment ${attachment.fetchUrl}: HTTP ${response.status}`);
  }
  return {
    buffer: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type') ?? attachment.mimeType,
  };
}

function inferFileName(mimeType: string): string {
  const [topLevel, subtype] = mimeType.split('/');
  if (!subtype) return 'attachment.bin';
  if (topLevel === 'image') return `image.${subtype}`;
  if (topLevel === 'video') return `video.${subtype}`;
  if (topLevel === 'audio') return `audio.${subtype}`;
  return `attachment.${subtype}`;
}
