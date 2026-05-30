import {
  extractPhoneListFromResponse,
  normalizePhoneDigits,
  resolveWebhookPhoneNumber,
  type WatiWhatsAppPhoneEntry,
} from './phone';
import {
  extractWebhookListFromResponse,
  findWebhookForPhoneAndUrl,
  isOverWebhookLimitResponse,
  isWebhookAlreadyExistsResponse,
  parseWatiJsonBody,
  type WatiWebhookEndpoint,
} from './webhooks';

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

  /**
   * List WhatsApp business numbers on the tenant (for webhook phoneNumber resolution).
   * Tries v2 then v1 list endpoints — not all tenants expose both.
   */
  async listWhatsAppPhoneNumbers(): Promise<WatiWhatsAppPhoneEntry[]> {
    const suffixes = ['/api/v2/whatsapp/phonenumbers', '/api/v1/whatsapp/phonenumbers'];

    for (const suffix of suffixes) {
      const url = this.path(suffix);
      const response = await fetch(url, { headers: this.authHeaders, method: 'GET' });
      if (!response.ok) continue;

      try {
        const json: unknown = await response.json();
        const list = extractPhoneListFromResponse(json);
        if (list.length > 0) return list;
      } catch {
        continue;
      }
    }

    return [];
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

  /** List configured webhook endpoints (best-effort; unsupported on some tenants). */
  async listWebhookEndpoints(): Promise<WatiWebhookEndpoint[]> {
    const suffixes = ['/api/v2/webhookEndpoints', '/api/v1/webhookEndpoints'];

    for (const suffix of suffixes) {
      const url = this.path(suffix);
      try {
        const response = await fetch(url, { headers: this.authHeaders, method: 'GET' });
        if (!response.ok) continue;

        const json: unknown = await response.json();
        return extractWebhookListFromResponse(json);
      } catch {
        continue;
      }
    }

    return [];
  }

  /**
   * Resolve the webhook `phoneNumber` field against Wati's channel list, then register.
   * Skips POST when the same phone + URL is already configured (idempotent).
   */
  async registerWebhookForPhone(
    configuredDigits: string,
    webhookUrl: string,
    eventTypes: string[] = ['message'],
  ): Promise<WatiWebhookEndpointsResponse> {
    const entries = await this.listWhatsAppPhoneNumbers();
    const candidates = new Set<string>();

    try {
      candidates.add(resolveWebhookPhoneNumber(configuredDigits, entries));
    } catch (resolveError) {
      const message = resolveError instanceof Error ? resolveError.message : String(resolveError);
      if (entries.length > 0) {
        throw new WatiApiError(message, 400);
      }
    }

    candidates.add(normalizePhoneDigits(configuredDigits));
    if (
      configuredDigits.startsWith('852') &&
      normalizePhoneDigits(configuredDigits).length === 11
    ) {
      const d = normalizePhoneDigits(configuredDigits);
      candidates.add(`852-${d.slice(3, 7)}-${d.slice(7)}`);
    }

    let lastError: WatiApiError | undefined;
    for (const phoneNumber of candidates) {
      if (!phoneNumber.trim()) continue;
      try {
        return await this.upsertWebhookEndpoints([
          { eventTypes, phoneNumber, status: 1, url: webhookUrl },
        ]);
      } catch (error) {
        if (error instanceof WatiApiError) {
          lastError = error;
          if (!error.message.includes('Channel not found')) throw error;
          continue;
        }
        throw error;
      }
    }

    throw (
      lastError ??
      new WatiApiError(
        `Could not register webhook for ${configuredDigits}. ` +
          'Confirm the number is connected in Wati (Connectors → WhatsApp accounts).',
        400,
      )
    );
  }

  async upsertWebhookEndpoints(
    entries: Array<{
      eventTypes?: string[];
      phoneNumber: string;
      status?: 0 | 1 | 2;
      url: string;
    }>,
  ): Promise<WatiWebhookEndpointsResponse> {
    if (entries.length === 0) {
      return { ok: true };
    }

    const existing = await this.listWebhookEndpoints();
    const allAlreadyRegistered = entries.every((entry) =>
      findWebhookForPhoneAndUrl(existing, entry.phoneNumber, entry.url),
    );
    if (allAlreadyRegistered) {
      return {
        ok: true,
        result: entries
          .map((entry) => findWebhookForPhoneAndUrl(existing, entry.phoneNumber, entry.url))
          .filter((item): item is WatiWebhookEndpoint => !!item),
      };
    }

    const url = `${this.apiBaseUrl}/${this.tenantId}/api/v2/webhookEndpoints`;
    const body = entries.map((entry) => ({
      eventTypes: entry.eventTypes ?? ['message'],
      phoneNumber: entry.phoneNumber,
      status: entry.status ?? 1,
      url: entry.url,
    }));

    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        ...this.authHeaders,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const detail = await safeResponseText(response);
      const parsed = parseWatiJsonBody(detail);

      if (isOverWebhookLimitResponse(parsed)) {
        return this.resolveWebhookLimit(entries);
      }

      if (isWebhookAlreadyExistsResponse(parsed)) {
        return this.resolveWebhookAlreadyExists(entries);
      }

      throw new WatiApiError(
        detail || `Wati webhookEndpoints failed (${response.status})`,
        response.status,
      );
    }

    try {
      const payload = (await response.json()) as WatiWebhookEndpointsResponse;
      const parsed =
        payload && typeof payload === 'object'
          ? (payload as unknown as Record<string, unknown>)
          : undefined;

      if (isOverWebhookLimitResponse(parsed)) {
        return this.resolveWebhookLimit(entries);
      }

      if (isWebhookAlreadyExistsResponse(parsed)) {
        return this.resolveWebhookAlreadyExists(entries);
      }

      if (parsed && parsed.ok === false) {
        throw new WatiApiError(JSON.stringify(payload), response.status);
      }

      return payload;
    } catch (error) {
      if (error instanceof WatiApiError) throw error;
      return { ok: true };
    }
  }

  private async resolveWebhookLimit(
    entries: Array<{
      eventTypes?: string[];
      phoneNumber: string;
      url: string;
    }>,
  ): Promise<WatiWebhookEndpointsResponse> {
    return this.resolveWebhookConflict(entries);
  }

  private async resolveWebhookAlreadyExists(
    entries: Array<{
      eventTypes?: string[];
      phoneNumber: string;
      url: string;
    }>,
  ): Promise<WatiWebhookEndpointsResponse> {
    return this.resolveWebhookConflict(entries);
  }

  /** Treat duplicate/limit webhook responses as idempotent success. */
  private async resolveWebhookConflict(
    entries: Array<{
      eventTypes?: string[];
      phoneNumber: string;
      url: string;
    }>,
  ): Promise<WatiWebhookEndpointsResponse> {
    const refreshed = await this.listWebhookEndpoints();
    const matched = entries
      .map((entry) => findWebhookForPhoneAndUrl(refreshed, entry.phoneNumber, entry.url))
      .filter((item): item is WatiWebhookEndpoint => !!item);

    if (matched.length === entries.length) {
      return { ok: true, result: matched };
    }

    const requested = entries.map((entry) => `${entry.phoneNumber} → ${entry.url}`).join('; ');

    throw new WatiApiError(
      'Webhook could not be confirmed on your Wati account. ' +
        `Wati reported a limit or duplicate conflict for ${requested}, ` +
        'but the webhook list does not contain that phone number and URL. ' +
        'Remove or replace an existing webhook in Wati (Connectors → Webhooks), then try again.',
      409,
    );
  }
}

/** Wati status for webhookEndpoints request body: 0 disabled, 1 enabled, 2 defective. */
export type WatiWebhookEndpointStatus = 0 | 1 | 2;

export interface WatiWebhookEndpointsResponse {
  ok?: boolean;
  result?: Array<{
    channelPhoneNumber?: string;
    eventTypes?: string[];
    id?: string;
    url?: string;
  }>;
}

const safeResponseText = async (response: Response): Promise<string> => {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
};
