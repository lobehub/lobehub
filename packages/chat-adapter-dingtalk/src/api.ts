import type {
  DingTalkAccessTokenResponse,
  DingTalkApiErrorBody,
  DingTalkBatchSendResponse,
  DingTalkConnectionOpenResponse,
  DingTalkFileDownloadResponse,
  DingTalkGroupSendResponse,
  DingTalkOutboundMessage,
  DingTalkSessionWebhookResponse,
  DingTalkStreamSubscription,
} from './types';

export const DINGTALK_API_BASE_URL = 'https://api.dingtalk.com';

/** `msgParam` of `groupMessages/send` is capped at 15000 bytes; keep headroom for JSON escaping. */
export const MAX_MSG_PARAM_TEXT_BYTES = 12_000;

/** Refresh the cached token this long before DingTalk's stated expiry. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const STREAM_UA = 'lobehub-chat-adapter-dingtalk/0.1.0';

export type DingTalkErrorKind =
  | 'auth'
  | 'invalid_request'
  | 'permission'
  | 'rate_limit'
  | 'server'
  | 'session_webhook'
  | 'unknown';

/**
 * Error raised for any non-success DingTalk response. `kind` is a coarse,
 * platform-independent classification callers can branch on; `code` keeps
 * DingTalk's original error code (e.g. `send.too.fast`, `InvalidAuthentication`).
 */
export class DingTalkApiError extends Error {
  readonly code?: string;
  readonly kind: DingTalkErrorKind;
  readonly requestId?: string;
  readonly status: number;

  constructor(options: {
    code?: string;
    kind: DingTalkErrorKind;
    message: string;
    requestId?: string;
    status: number;
  }) {
    super(options.message);
    this.name = 'DingTalkApiError';
    this.code = options.code;
    this.kind = options.kind;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

const AUTH_ERROR_CODES = new Set([
  'Forbidden.AccessDenied.AccessTokenInvalid',
  'InvalidAuthentication',
  'invalidParameter.token.invalid',
]);

const RATE_LIMIT_PATTERN = /throttl|too\.?fast|qpslimit|too\.many/i;
const PERMISSION_CODES = new Set(['bot.forbidden.sendMessage', 'send.forbidden', 'unauthorized']);

/** Map an HTTP status + DingTalk error code to an error kind. */
export function classifyDingTalkError(status: number, code?: string): DingTalkErrorKind {
  if (status === 401 || (code && AUTH_ERROR_CODES.has(code))) return 'auth';
  if (status === 429 || (code && RATE_LIMIT_PATTERN.test(code))) return 'rate_limit';
  if (status === 403 || (code && (PERMISSION_CODES.has(code) || code.startsWith('Forbidden')))) {
    return 'permission';
  }
  if (status >= 500 || code === 'system.error') return 'server';
  if (status >= 400) return 'invalid_request';
  return 'unknown';
}

async function toApiError(response: Response, context: string): Promise<DingTalkApiError> {
  const text = await response.text().catch(() => '');
  let body: DingTalkApiErrorBody = {};
  try {
    body = JSON.parse(text) as DingTalkApiErrorBody;
  } catch {
    // non-JSON body
  }

  return new DingTalkApiError({
    code: body.code,
    kind: classifyDingTalkError(response.status, body.code),
    message: `DingTalk ${context} failed: ${response.status} ${body.code ?? ''} ${
      body.message ?? text
    }`.trim(),
    requestId: body.requestid,
    status: response.status,
  });
}

/** Truncate a string so its UTF-8 encoding stays within `maxBytes`. */
export function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;

  const suffix = '...';
  const budget = maxBytes - suffix.length;
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > budget) break;
    bytes += size;
    end += char.length;
  }
  return text.slice(0, end) + suffix;
}

export class DingTalkApiClient {
  readonly clientId: string;
  readonly robotCode: string;
  private readonly clientSecret: string;
  private cachedToken?: string;
  private tokenExpiresAt = 0;
  private pendingToken?: Promise<string>;

  constructor(clientId: string, clientSecret: string, robotCode?: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.robotCode = robotCode || clientId;
  }

  // ==================== Auth ====================

  /**
   * Get an internal-app access token (`POST /v1.0/oauth2/accessToken`).
   * Cached until 5 minutes before `expireIn`; concurrent callers share one request.
   */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }
    if (this.pendingToken) return this.pendingToken;

    this.pendingToken = this.fetchAccessToken().finally(() => {
      this.pendingToken = undefined;
    });
    return this.pendingToken;
  }

  /** Drop the cached token so the next call fetches a new one. */
  invalidateAccessToken(): void {
    this.cachedToken = undefined;
    this.tokenExpiresAt = 0;
  }

  private async fetchAccessToken(): Promise<string> {
    const response = await fetch(`${DINGTALK_API_BASE_URL}/v1.0/oauth2/accessToken`, {
      body: JSON.stringify({ appKey: this.clientId, appSecret: this.clientSecret }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await toApiError(response, 'auth');
      // Any 4xx from the token endpoint means the credentials are wrong.
      if (response.status < 500) {
        throw new DingTalkApiError({
          code: error.code,
          kind: 'auth',
          message: error.message,
          requestId: error.requestId,
          status: error.status,
        });
      }
      throw error;
    }

    const data = (await response.json()) as DingTalkAccessTokenResponse;
    if (!data.accessToken) {
      throw new DingTalkApiError({
        kind: 'auth',
        message: 'DingTalk auth failed: response has no accessToken',
        status: response.status,
      });
    }

    this.cachedToken = data.accessToken;
    const ttlMs = (data.expireIn || 7200) * 1000;
    this.tokenExpiresAt = Date.now() + Math.max(ttlMs - TOKEN_REFRESH_MARGIN_MS, ttlMs / 2);
    return data.accessToken;
  }

  /**
   * Authenticated OpenAPI call. An auth failure (token revoked or expired
   * early) invalidates the cached token and retries once with a fresh one.
   */
  private async call<T>(path: string, body: Record<string, unknown>, retried = false): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${DINGTALK_API_BASE_URL}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await toApiError(response, `API POST ${path}`);
      if (error.kind === 'auth' && !retried) {
        this.invalidateAccessToken();
        return this.call<T>(path, body, true);
      }
      throw error;
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  // ==================== Stream gateway ====================

  /**
   * Register a Stream connection (`POST /v1.0/gateway/connections/open`).
   * Uses the client credentials directly, not an access token. The returned
   * ticket is single-use and valid for 90 seconds.
   */
  async openStreamConnection(
    subscriptions: DingTalkStreamSubscription[],
  ): Promise<DingTalkConnectionOpenResponse> {
    const response = await fetch(`${DINGTALK_API_BASE_URL}/v1.0/gateway/connections/open`, {
      body: JSON.stringify({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        subscriptions,
        ua: STREAM_UA,
      }),
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw await toApiError(response, 'stream connection open');
    }

    const data = (await response.json()) as DingTalkConnectionOpenResponse;
    if (!data.endpoint || !data.ticket) {
      throw new DingTalkApiError({
        kind: 'unknown',
        message: 'DingTalk stream connection open returned no endpoint/ticket',
        status: response.status,
      });
    }
    return data;
  }

  // ==================== Robot messages ====================

  /** Send a one-on-one message (`POST /v1.0/robot/oToMessages/batchSend`). */
  async sendSingleMessage(
    userIds: string[],
    message: DingTalkOutboundMessage,
  ): Promise<DingTalkBatchSendResponse> {
    const result = await this.call<DingTalkBatchSendResponse>('/v1.0/robot/oToMessages/batchSend', {
      msgKey: message.msgKey,
      msgParam: JSON.stringify(message.msgParam),
      robotCode: this.robotCode,
      userIds,
    });

    const rejected = [
      ...(result.invalidStaffIdList ?? []).map((id) => ({ id, kind: 'invalid_request' as const })),
      ...(result.flowControlledStaffIdList ?? []).map((id) => ({
        id,
        kind: 'rate_limit' as const,
      })),
    ];
    // batchSend answers 200 even when every recipient was rejected.
    if (rejected.length > 0 && rejected.length >= userIds.length) {
      const first = rejected[0];
      throw new DingTalkApiError({
        code: first.kind === 'rate_limit' ? 'flowControlled' : 'invalidStaffId',
        kind: first.kind,
        message: `DingTalk batchSend rejected recipients: ${rejected.map((r) => r.id).join(',')}`,
        status: 200,
      });
    }
    return result;
  }

  /** Send a group message (`POST /v1.0/robot/groupMessages/send`). */
  async sendGroupMessage(
    openConversationId: string,
    message: DingTalkOutboundMessage,
  ): Promise<DingTalkGroupSendResponse> {
    return this.call<DingTalkGroupSendResponse>('/v1.0/robot/groupMessages/send', {
      msgKey: message.msgKey,
      msgParam: JSON.stringify(message.msgParam),
      openConversationId,
      robotCode: this.robotCode,
    });
  }

  /**
   * Reply through the callback's `sessionWebhook`. The URL itself is the
   * credential, so no access token is sent. DingTalk answers HTTP 200 with a
   * non-zero `errcode` on failure (e.g. an expired session); both cases throw
   * a `session_webhook` error so callers can fall back to the OpenAPI.
   */
  async replyViaSessionWebhook(
    sessionWebhook: string,
    message: DingTalkOutboundMessage,
    atUserIds?: string[],
  ): Promise<void> {
    const at = atUserIds?.length ? { atUserIds } : undefined;
    let body: Record<string, unknown>;
    switch (message.msgKey) {
      case 'sampleText': {
        body = { at, msgtype: 'text', text: { content: message.msgParam.content } };
        break;
      }
      case 'sampleMarkdown': {
        body = { at, markdown: message.msgParam, msgtype: 'markdown' };
        break;
      }
      case 'sampleImageMsg': {
        body = {
          at,
          markdown: { text: `![image](${message.msgParam.photoURL})`, title: 'image' },
          msgtype: 'markdown',
        };
        break;
      }
    }

    let response: Response;
    try {
      response = await fetch(sessionWebhook, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new DingTalkApiError({
        kind: 'session_webhook',
        message: `DingTalk sessionWebhook request failed: ${(err as Error)?.message ?? err}`,
        status: 0,
      });
    }

    const text = await response.text().catch(() => '');
    let data: DingTalkSessionWebhookResponse = {};
    try {
      data = text ? (JSON.parse(text) as DingTalkSessionWebhookResponse) : {};
    } catch {
      // non-JSON body
    }

    if (!response.ok || (data.errcode !== undefined && data.errcode !== 0)) {
      throw new DingTalkApiError({
        code: data.errcode !== undefined ? String(data.errcode) : undefined,
        kind: 'session_webhook',
        message: `DingTalk sessionWebhook failed: ${response.status} ${data.errcode ?? ''} ${
          data.errmsg ?? text
        }`.trim(),
        status: response.status,
      });
    }
  }

  // ==================== Files ====================

  /**
   * Exchange an inbound message `downloadCode` for a temporary download URL
   * (`POST /v1.0/robot/messageFiles/download`).
   */
  async getFileDownloadUrl(downloadCode: string): Promise<string> {
    const data = await this.call<DingTalkFileDownloadResponse>(
      '/v1.0/robot/messageFiles/download',
      { downloadCode, robotCode: this.robotCode },
    );
    return data.downloadUrl;
  }

  async downloadFile(downloadCode: string): Promise<Buffer> {
    const url = await this.getFileDownloadUrl(downloadCode);
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      throw await toApiError(response, 'file download');
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
