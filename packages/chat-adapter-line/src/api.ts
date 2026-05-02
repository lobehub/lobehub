import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  LineApiError,
  LineBotInfoResponse,
  LineLoadingStartRequest,
  LinePushMessageRequest,
} from './types';

export const DEFAULT_API_BASE_URL = 'https://api.line.me';
export const DEFAULT_API_DATA_BASE_URL = 'https://api-data.line.me';

/**
 * LINE Messaging API REST client.
 *
 * Stateless — instances are cheap to create and reuse. All methods throw on
 * HTTP failure with the LINE error envelope's `message` field, including
 * the first detail from `details[]` when present so 400 / 401 surface a
 * useful operator-facing reason.
 */
export class LineApiClient {
  readonly accessToken: string;
  readonly baseUrl: string;
  readonly dataBaseUrl: string;

  constructor(options: { accessToken: string; baseUrl?: string; dataBaseUrl?: string }) {
    this.accessToken = options.accessToken;
    this.baseUrl = stripTrailingSlashes(options.baseUrl || DEFAULT_API_BASE_URL);
    this.dataBaseUrl = stripTrailingSlashes(options.dataBaseUrl || DEFAULT_API_DATA_BASE_URL);
  }

  private get authHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Send a plain-text push message. We always use push (not reply) because
   * LINE's `replyToken` expires in ~60 s and the agent's response can take
   * longer than that. Push counts against the channel quota for paid plans;
   * for the free Developer Trial it's effectively unlimited.
   * @see https://developers.line.biz/en/reference/messaging-api/#send-push-message
   */
  async pushText(to: string, body: string): Promise<void> {
    const payload: LinePushMessageRequest = {
      messages: [{ text: body, type: 'text' }],
      to,
    };
    await this.post('/v2/bot/message/push', payload);
  }

  /**
   * Surface the typing-style "loading" animation in a 1:1 user chat. LINE
   * does not expose this for groups or multi-person rooms — callers must
   * already have decided the recipient is a user. Returns silently on
   * non-user recipients to keep the messenger interface uniform.
   * @see https://developers.line.biz/en/reference/messaging-api/#display-a-loading-indicator
   */
  async startLoading(chatId: string, loadingSeconds = 20): Promise<void> {
    const payload: LineLoadingStartRequest = { chatId, loadingSeconds };
    await this.post('/v2/bot/chat/loading/start', payload);
  }

  /**
   * Resolve binary content for a media `messageId`. The response is the raw
   * bytes — the call is on the data-domain host, not the API host.
   * @see https://developers.line.biz/en/reference/messaging-api/#get-content
   */
  async downloadContent(messageId: string): Promise<Buffer> {
    const url = `${this.dataBaseUrl}/v2/bot/message/${encodeURIComponent(messageId)}/content`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      method: 'GET',
    });
    if (!res.ok) {
      const detail = await safeReadError(res);
      throw new Error(detail || `downloadContent ${messageId} failed with HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Verify the access token + bot identity. Used both by the lobehub
   * `validateCredentials` flow and by the platform client `start()` to
   * guard against a clearly-broken provider reaching the connected state.
   * @see https://developers.line.biz/en/reference/messaging-api/#get-bot-info
   */
  async getBotInfo(): Promise<LineBotInfoResponse> {
    const res = await fetch(`${this.baseUrl}/v2/bot/info`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      method: 'GET',
    });
    return parseResponse<LineBotInfoResponse>(res, 'getBotInfo');
  }

  private async post(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers: this.authHeaders,
      method: 'POST',
    });
    if (!res.ok) {
      const detail = await safeReadError(res);
      throw new Error(detail || `${path} failed with HTTP ${res.status}`);
    }
  }
}

/**
 * Compute the expected `X-Line-Signature` value for an inbound webhook body.
 * LINE signs the **raw bytes** of the request body with the channel secret
 * and emits the digest in **base64** (not hex like WhatsApp).
 */
export function computeSignature(body: string, channelSecret: string): string {
  const hmac = createHmac('sha256', channelSecret);
  hmac.update(body, 'utf8');
  return hmac.digest('base64');
}

/**
 * Validate an `X-Line-Signature` header. Returns false on missing / malformed
 * / mismatched signatures — never throws.
 */
export function verifySignature(
  body: string,
  signatureHeader: string | null | undefined,
  channelSecret: string,
): boolean {
  if (!signatureHeader || !channelSecret) return false;
  const expected = computeSignature(body, channelSecret);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

async function parseResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  let payload: T | undefined;
  try {
    payload = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const errMsg = readErrorMessage(payload as LineApiError | undefined);
    throw new Error(errMsg || `${label} failed with HTTP ${response.status}`);
  }

  return (payload ?? ({} as T)) as T;
}

async function safeReadError(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    const payload = JSON.parse(text) as LineApiError;
    return readErrorMessage(payload);
  } catch {
    return undefined;
  }
}

function readErrorMessage(payload: LineApiError | undefined): string | undefined {
  if (!payload) return undefined;
  const detailMsg = payload.details?.[0]?.message;
  if (payload.message && detailMsg) return `${payload.message}: ${detailMsg}`;
  return payload.message ?? detailMsg;
}
