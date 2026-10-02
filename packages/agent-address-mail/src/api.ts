import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  EmailApiError,
  EmailInbox,
  EmailMessageDetail,
  EmailWebhook,
  EmailWebhookEvent,
} from './types';

export const DEFAULT_API_BASE_URL = 'https://api.lobe.id';

/** Default tolerance for the webhook signature timestamp — 5 minutes. */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

const hmacHex = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('hex');

/**
 * Signature header format, per the Agent Mail docs:
 * `X-AgentMail-Signature: t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<body>">`.
 */
export const computeAgentMailSignature = (
  secret: string,
  body: string,
  timestamp: number,
): string => `t=${timestamp},v1=${hmacHex(secret, `${timestamp}.${body}`)}`;

export const parseAgentMailSignature = (
  header: string | null | undefined,
): { t: number; v1: string } | null => {
  if (!header) return null;
  const parts = new Map(
    header
      .split(',')
      .map((segment) => segment.split('='))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([key, value]) => [key.trim(), value.trim()]),
  );
  const rawTimestamp = parts.get('t');
  const v1 = parts.get('v1');
  if (!rawTimestamp || !v1) return null;
  const t = Number.parseInt(rawTimestamp, 10);
  if (!Number.isFinite(t)) return null;
  return { t, v1 };
};

/**
 * Verify a webhook delivery. Returns `false` (never throws) when the header is
 * malformed, the timestamp falls outside the tolerance window, or the HMAC
 * does not match — so the caller can answer 401 without leaking which check
 * failed.
 *
 * `now` is injectable for tests.
 */
export const verifyAgentMailSignature = (params: {
  body: string;
  header: string | null | undefined;
  now?: number;
  secret: string;
  toleranceSeconds?: number;
}): boolean => {
  const { body, header, secret } = params;
  if (!secret) return false;

  const parsed = parseAgentMailSignature(header);
  if (!parsed) return false;

  const now = Math.floor((params.now ?? Date.now()) / 1000);
  const tolerance = params.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  // Reject both stale and future-dated signatures — an attacker replaying or
  // pre-computing a timestamp must fall inside the same window as a retry.
  if (Math.abs(now - parsed.t) > tolerance) return false;

  const expected = Buffer.from(hmacHex(secret, `${parsed.t}.${body}`), 'utf8');
  const provided = Buffer.from(parsed.v1, 'utf8');
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
};

// Scanned rather than matched with `/\/+$/`: a regex anchored at the end
// backtracks polynomially on a slash-heavy string, and this runs on a
// caller-supplied base URL.
const stripTrailingSlashes = (url: string) => {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end -= 1;
  return url.slice(0, end);
};

/**
 * Agent Mail REST client. Stateless and cheap to construct — every method
 * throws on a non-2xx response with the service's `{ error: { code, message } }`
 * envelope flattened into the message.
 */
export class LobeMailApiClient {
  readonly apiKey: string;
  readonly baseUrl: string;

  private readonly fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.apiKey = options.apiKey;
    this.baseUrl = stripTrailingSlashes(options.baseUrl || DEFAULT_API_BASE_URL);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let detail = body;
      try {
        const parsed = JSON.parse(body) as EmailApiError;
        detail = parsed.error?.message || parsed.error?.code || body;
      } catch {
        // keep the raw body
      }
      throw new Error(
        `Agent Mail ${init.method ?? 'GET'} ${path} failed: ${response.status}${
          detail ? ` — ${detail}` : ''
        }`,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  // ---------------- Inboxes ----------------

  createInbox = (input: {
    clientId?: string;
    displayName?: string;
    endUserId?: string;
    metadata?: Record<string, unknown>;
    username?: string;
  }): Promise<EmailInbox> =>
    this.request<EmailInbox>('/v1/inboxes', { body: JSON.stringify(input), method: 'POST' });

  getInbox = (idOrAddress: string): Promise<EmailInbox> =>
    this.request<EmailInbox>(`/v1/inboxes/${encodeURIComponent(idOrAddress)}`);

  listInboxes = (params?: {
    clientId?: string;
    endUserId?: string;
    limit?: number;
  }): Promise<{ data: EmailInbox[] }> => {
    const query = new URLSearchParams();
    if (params?.clientId) query.set('clientId', params.clientId);
    if (params?.endUserId) query.set('endUserId', params.endUserId);
    if (params?.limit) query.set('limit', String(params.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.request<{ data: EmailInbox[] }>(`/v1/inboxes${suffix}`);
  };

  deleteInbox = (idOrAddress: string): Promise<void> =>
    this.request<void>(`/v1/inboxes/${encodeURIComponent(idOrAddress)}`, { method: 'DELETE' });

  // ---------------- Webhooks ----------------

  createWebhook = (input: {
    events?: string[];
    inboxId?: string;
    url: string;
  }): Promise<EmailWebhook> =>
    this.request<EmailWebhook>('/v1/webhooks', { body: JSON.stringify(input), method: 'POST' });

  listWebhooks = (): Promise<{ data: EmailWebhook[] }> =>
    this.request<{ data: EmailWebhook[] }>('/v1/webhooks');

  deleteWebhook = (id: string): Promise<void> =>
    this.request<void>(`/v1/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });

  // ---------------- Messages ----------------

  getMessage = (id: string): Promise<EmailMessageDetail> =>
    this.request<EmailMessageDetail>(`/v1/messages/${encodeURIComponent(id)}`);

  /**
   * Fetch the original `message/rfc822`. Used for loop protection: the JSON
   * message shape exposes no arbitrary headers, so `Auto-Submitted` /
   * `Precedence` / `List-Id` are only readable from the raw source.
   * Returns `null` instead of throwing — a missing raw body must not block
   * a legitimate inbound message.
   */
  getRawMessage = async (id: string): Promise<null | string> => {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v1/messages/${encodeURIComponent(id)}/raw`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        },
      );
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  };

  replyToMessage = (
    id: string,
    input: { html?: string; replyAll?: boolean; text?: string },
  ): Promise<EmailMessageDetail> =>
    this.request<EmailMessageDetail>(`/v1/messages/${encodeURIComponent(id)}/reply`, {
      body: JSON.stringify(input),
      method: 'POST',
    });

  /**
   * Download an attachment's bytes. Never throws — attachments are optional
   * context and a failure must not fail the whole inbound turn.
   */
  downloadAttachment = async (
    messageId: string,
    index: number,
  ): Promise<null | { buffer: Buffer; contentType?: string }> => {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v1/messages/${encodeURIComponent(messageId)}/attachments/${index}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } },
      );
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        buffer: bytes,
        contentType: response.headers.get('content-type') ?? undefined,
      };
    } catch {
      return null;
    }
  };

  sendMessage = (
    inboxId: string,
    input: { html?: string; subject: string; text?: string; to: string },
  ): Promise<EmailMessageDetail> =>
    this.request<EmailMessageDetail>(`/v1/inboxes/${encodeURIComponent(inboxId)}/messages`, {
      body: JSON.stringify(input),
      method: 'POST',
    });

  waitForMessage = (
    inboxId: string,
    params?: {
      from?: string;
      markRead?: boolean;
      since?: string;
      subject?: string;
      timeout?: number;
    },
  ): Promise<{ message: EmailMessageDetail | null; timedOut: boolean }> => {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.subject) query.set('subject', params.subject);
    if (params?.since) query.set('since', params.since);
    if (params?.timeout !== undefined) query.set('timeout', String(params.timeout));
    if (params?.markRead !== undefined) query.set('markRead', String(params.markRead));
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.request<{ message: EmailMessageDetail | null; timedOut: boolean }>(
      `/v1/inboxes/${encodeURIComponent(inboxId)}/messages/wait${suffix}`,
    );
  };
}

export type { EmailMessageDetail as EmailMessage, EmailWebhookEvent };
