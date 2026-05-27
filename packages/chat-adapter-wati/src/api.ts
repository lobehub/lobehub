import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_WATI_API_BASE_URL = 'https://live-mt-server.wati.io';

const stripTrailingSlashes = (url: string) => url.replace(/\/+$/, '');

export class WatiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'WatiApiError';
  }
}

/**
 * Wati REST client (API v1 paths from OpenAPI spec).
 */
export class WatiApiClient {
  readonly apiBaseUrl: string;
  readonly bearerToken: string;
  readonly tenantId: string;

  constructor(options: { apiBaseUrl: string; bearerToken: string; tenantId: string }) {
    this.apiBaseUrl = stripTrailingSlashes(options.apiBaseUrl || DEFAULT_WATI_API_BASE_URL);
    this.bearerToken = options.bearerToken;
    this.tenantId = options.tenantId;
  }

  private path(suffix: string): string {
    const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `${this.apiBaseUrl}/${this.tenantId}${normalized}`;
  }

  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.bearerToken}`,
    };
  }

  /**
   * Send a session (24h window) text message to a WhatsApp user.
   * @see POST /{tenantId}/api/v1/sendSessionMessage/{whatsappNumber}
   */
  async sendSessionMessage(
    whatsappNumber: string,
    messageText: string,
    options?: { channelPhoneNumber?: string; replyContextId?: string },
  ): Promise<void> {
    const params = new URLSearchParams();
    params.set('messageText', messageText);
    if (options?.channelPhoneNumber) {
      params.set('channelPhoneNumber', options.channelPhoneNumber);
    }
    if (options?.replyContextId) {
      params.set('replyContextId', options.replyContextId);
    }

    const url = `${this.path(`/api/v1/sendSessionMessage/${encodeURIComponent(whatsappNumber)}`)}?${params}`;

    const response = await fetch(url, {
      headers: this.authHeaders,
      method: 'POST',
    });

    if (!response.ok) {
      const detail = await safeResponseText(response);
      throw new WatiApiError(
        detail || `Wati sendSessionMessage failed (${response.status})`,
        response.status,
      );
    }
  }

  /** Lightweight auth check — list one contact page. */
  async ping(): Promise<void> {
    const url = `${this.path('/api/v1/getContacts')}?pageSize=1&pageNumber=1`;
    const response = await fetch(url, { headers: this.authHeaders, method: 'GET' });
    if (!response.ok) {
      const detail = await safeResponseText(response);
      throw new WatiApiError(
        detail || `Wati getContacts failed (${response.status})`,
        response.status,
      );
    }
  }
}

const safeResponseText = async (response: Response): Promise<string> => {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
};

/** HMAC-SHA256 hex digest of `body` using `secret`. */
export const computeSignature = (body: string, secret: string): string =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex');

/**
 * Verify an inbound Wati webhook signature when a secret is configured.
 * Accepts raw hex or `sha256=<hex>` forms on common header names.
 */
export const verifyWebhookSignature = (
  body: string,
  signatureHeader: string | null,
  secret: string,
): boolean => {
  if (!signatureHeader?.trim()) return false;

  const expected = computeSignature(body, secret);
  const candidates = [signatureHeader.trim()];

  for (const prefix of ['sha256=', 'SHA256=']) {
    if (signatureHeader.startsWith(prefix)) {
      candidates.push(signatureHeader.slice(prefix.length).trim());
    }
  }

  for (const candidate of candidates) {
    try {
      const a = Buffer.from(candidate, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      // try next candidate
    }
  }

  return false;
};
