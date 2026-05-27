import { randomUUID } from 'node:crypto';

import type {
  BlueBubblesApiConfig,
  BlueBubblesAttachment,
  BlueBubblesChat,
  BlueBubblesDownloadedAttachment,
  BlueBubblesMessage,
  BlueBubblesOutboundAttachment,
  BlueBubblesQueryResult,
  BlueBubblesResponse,
  BlueBubblesSendOptions,
  BlueBubblesWebhook,
} from './types';

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

interface RequestOptions {
  body?: FormData | Record<string, unknown>;
  method?: 'DELETE' | 'GET' | 'POST';
  query?: Record<string, boolean | number | string | undefined>;
  signal?: AbortSignal;
}

export class BlueBubblesApiClient {
  readonly password: string;
  readonly requestTimeoutMs: number;
  readonly serverUrl: string;

  constructor(options: BlueBubblesApiConfig) {
    if (!options.serverUrl?.trim()) throw new Error('BlueBubbles serverUrl is required');
    if (!options.password?.trim()) throw new Error('BlueBubbles password is required');

    this.serverUrl = stripTrailingSlashes(options.serverUrl.trim());
    this.password = options.password;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async ping(): Promise<void> {
    await this.requestData<Record<string, unknown>>('ping');
  }

  async getMessage(
    guid: string,
    withParts: string[] = ['chats', 'attachments'],
  ): Promise<BlueBubblesMessage> {
    return this.requestData<BlueBubblesMessage>(`message/${encodeURIComponent(guid)}`, {
      query: { with: withParts.join(',') },
    });
  }

  async getChat(guid: string, withParts: string[] = ['participants']): Promise<BlueBubblesChat> {
    return this.requestData<BlueBubblesChat>(`chat/${encodeURIComponent(guid)}`, {
      query: { with: withParts.join(',') },
    });
  }

  async getChatMessages(
    chatGuid: string,
    options: {
      after?: number | string;
      before?: number | string;
      limit?: number;
      offset?: number;
      sort?: 'ASC' | 'DESC';
      withParts?: string[];
    } = {},
  ): Promise<BlueBubblesQueryResult<BlueBubblesMessage>> {
    const response = await this.request<BlueBubblesMessage[]>(
      `chat/${encodeURIComponent(chatGuid)}/message`,
      {
        query: {
          after: options.after,
          before: options.before,
          limit: options.limit,
          offset: options.offset,
          sort: options.sort,
          with: (options.withParts ?? ['attachments']).join(','),
        },
      },
    );
    return { data: response.data ?? [], metadata: response.metadata };
  }

  async queryMessages(
    body: Record<string, unknown>,
  ): Promise<BlueBubblesQueryResult<BlueBubblesMessage>> {
    const response = await this.request<BlueBubblesMessage[]>('message/query', {
      body,
      method: 'POST',
    });
    return { data: response.data ?? [], metadata: response.metadata };
  }

  async queryChats(
    body: Record<string, unknown>,
  ): Promise<BlueBubblesQueryResult<BlueBubblesChat>> {
    const response = await this.request<BlueBubblesChat[]>('chat/query', {
      body,
      method: 'POST',
    });
    return { data: response.data ?? [], metadata: response.metadata };
  }

  async registerWebhook(
    url: string,
    events: string[] = ['new-message'],
  ): Promise<BlueBubblesWebhook> {
    return this.requestData<BlueBubblesWebhook>('webhook', {
      body: { events, url },
      method: 'POST',
    });
  }

  async listWebhooks(url?: string): Promise<BlueBubblesWebhook[]> {
    const response = await this.request<BlueBubblesWebhook[]>('webhook', {
      query: { url },
    });
    return response.data ?? [];
  }

  async sendText(
    chatGuid: string,
    message: string,
    options: BlueBubblesSendOptions = {},
  ): Promise<BlueBubblesMessage> {
    return this.requestData<BlueBubblesMessage>('message/text', {
      body: {
        chatGuid,
        message,
        method: options.method ?? 'apple-script',
        tempGuid: options.tempGuid ?? randomUUID(),
      },
      method: 'POST',
    });
  }

  async sendAttachment(
    chatGuid: string,
    attachment: BlueBubblesOutboundAttachment,
    options: BlueBubblesSendOptions = {},
  ): Promise<BlueBubblesMessage> {
    const { buffer, mimeType } = await resolveAttachmentBytes(attachment, this.requestTimeoutMs);
    const name = attachment.name || inferFileName(mimeType || attachment.mimeType);
    const form = new FormData();
    const attachmentBytes = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    form.set('chatGuid', chatGuid);
    form.set('tempGuid', options.tempGuid ?? randomUUID());
    form.set('method', options.method ?? 'apple-script');
    form.set('name', name);
    form.set(
      'attachment',
      new Blob([attachmentBytes], { type: mimeType ?? attachment.mimeType }),
      name,
    );

    return this.requestData<BlueBubblesMessage>('message/attachment', {
      body: form,
      method: 'POST',
    });
  }

  async startTyping(chatGuid: string): Promise<void> {
    await this.requestData<Record<string, unknown>>(`chat/${encodeURIComponent(chatGuid)}/typing`, {
      method: 'POST',
    });
  }

  async stopTyping(chatGuid: string): Promise<void> {
    await this.requestData<Record<string, unknown>>(`chat/${encodeURIComponent(chatGuid)}/typing`, {
      method: 'DELETE',
    });
  }

  async downloadAttachment(guid: string): Promise<BlueBubblesDownloadedAttachment> {
    const url = this.buildUrl(`attachment/${encodeURIComponent(guid)}/download`, {
      original: true,
    });
    const response = await fetchWithTimeout(url, { method: 'GET' }, this.requestTimeoutMs);
    if (!response.ok) {
      const detail = await safeReadError(response);
      throw new Error(detail || `downloadAttachment ${guid} failed with HTTP ${response.status}`);
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type') ?? undefined,
    };
  }

  private async requestData<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request<T>(path, options);
    return (response.data ?? ({} as T)) as T;
  }

  private async request<T>(
    path: string,
    { method = 'GET', body, query, signal }: RequestOptions = {},
  ): Promise<BlueBubblesResponse<T>> {
    const url = this.buildUrl(path, query);
    const init: RequestInit = { method, signal };

    if (body instanceof FormData) {
      init.body = body;
    } else if (body) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }

    const response = await fetchWithTimeout(url, init, this.requestTimeoutMs);
    return parseResponse<T>(response, path);
  }

  private buildUrl(
    path: string,
    query?: Record<string, boolean | number | string | undefined>,
  ): string {
    const url = new URL(path.replace(/^\/+/, ''), `${this.serverUrl}/api/v1/`);
    url.searchParams.set('password', this.password);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}

async function parseResponse<T>(
  response: Response,
  label: string,
): Promise<BlueBubblesResponse<T>> {
  const text = await response.text();
  const payload = parseJson<BlueBubblesResponse<T>>(text);

  if (!response.ok) {
    const detail = readBlueBubblesError(payload) ?? text;
    throw new Error(detail || `${label} failed with HTTP ${response.status}`);
  }

  return payload ?? {};
}

async function safeReadError(response: Response): Promise<string | undefined> {
  const text = await response.text();
  const payload = parseJson<BlueBubblesResponse>(text);
  return readBlueBubblesError(payload) ?? (text || undefined);
}

function readBlueBubblesError(payload: BlueBubblesResponse | undefined): string | undefined {
  if (!payload) return undefined;
  const data = payload.data as { error?: unknown; message?: unknown } | undefined;
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.message === 'string') return data.message;
  return payload.message;
}

function parseJson<T>(text: string): T | undefined {
  if (!text) return undefined;
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
  attachment: BlueBubblesOutboundAttachment,
  requestTimeoutMs: number,
): Promise<{ buffer: Buffer; mimeType?: string }> {
  if (attachment.data) {
    return { buffer: Buffer.from(attachment.data, 'base64'), mimeType: attachment.mimeType };
  }

  if (!attachment.fetchUrl) {
    throw new Error('BlueBubbles attachment requires either data or fetchUrl');
  }

  const response = await fetchWithTimeout(attachment.fetchUrl, { method: 'GET' }, requestTimeoutMs);
  if (!response.ok) {
    throw new Error(`Failed to fetch attachment ${attachment.fetchUrl}: HTTP ${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type') ?? attachment.mimeType,
  };
}

function inferFileName(mimeType: string | undefined): string {
  if (!mimeType) return 'attachment.bin';
  const [topLevel, subtype] = mimeType.split('/');
  if (!subtype) return 'attachment.bin';
  if (topLevel === 'image') return `image.${subtype}`;
  if (topLevel === 'video') return `video.${subtype}`;
  if (topLevel === 'audio') return `audio.${subtype}`;
  return `attachment.${subtype}`;
}

export function resolveAttachmentName(attachment: BlueBubblesAttachment): string {
  return attachment.transferName || attachment.filename || `${attachment.guid}.bin`;
}
