import type {
  WhatsAppApiError,
  WhatsAppMediaInfo,
  WhatsAppPhoneNumberInfo,
  WhatsAppSendMessageResponse,
} from './types';

export const DEFAULT_WHATSAPP_API_BASE_URL = 'https://graph.facebook.com';
export const DEFAULT_WHATSAPP_GRAPH_API_VERSION = 'v25.0';

interface WhatsAppApiOptions {
  accessToken: string;
  apiBaseUrl?: string;
  graphApiVersion?: string;
  phoneNumberId: string;
}

function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

function normalizeGraphApiVersion(version?: string): string {
  const value = version?.trim();
  if (!value) return DEFAULT_WHATSAPP_GRAPH_API_VERSION;
  return value.startsWith('v') ? value : `v${value}`;
}

function readErrorMessage(payload: WhatsAppApiError | undefined): string | undefined {
  return payload?.error?.message;
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
    const message = readErrorMessage(payload as WhatsAppApiError | undefined);
    throw new Error(message || `${label} failed with HTTP ${response.status}`);
  }

  return (payload ?? ({} as T)) as T;
}

export class WhatsAppApi {
  readonly accessToken: string;
  readonly apiBaseUrl: string;
  readonly graphApiVersion: string;
  readonly phoneNumberId: string;

  constructor(options: WhatsAppApiOptions) {
    this.accessToken = options.accessToken;
    this.apiBaseUrl = stripTrailingSlashes(options.apiBaseUrl || DEFAULT_WHATSAPP_API_BASE_URL);
    this.graphApiVersion = normalizeGraphApiVersion(options.graphApiVersion);
    this.phoneNumberId = options.phoneNumberId;
  }

  private get apiRoot(): string {
    return `${this.apiBaseUrl}/${this.graphApiVersion}`;
  }

  private get authHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  async getPhoneNumberInfo(): Promise<WhatsAppPhoneNumberInfo> {
    const fields = [
      'id',
      'display_phone_number',
      'verified_name',
      'quality_rating',
      'code_verification_status',
      'platform_type',
    ].join(',');
    const res = await fetch(
      `${this.apiRoot}/${encodeURIComponent(this.phoneNumberId)}?fields=${fields}`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        method: 'GET',
      },
    );
    return parseResponse<WhatsAppPhoneNumberInfo>(res, 'getPhoneNumberInfo');
  }

  async sendText(to: string, body: string): Promise<{ id?: string }> {
    if (!body.trim()) {
      throw new Error('WhatsApp API sendText skipped: text is empty');
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      text: {
        body: this.truncateText(body),
        preview_url: false,
      },
      to,
      type: 'text',
    };

    const res = await fetch(`${this.apiRoot}/${encodeURIComponent(this.phoneNumberId)}/messages`, {
      body: JSON.stringify(payload),
      headers: this.authHeaders,
      method: 'POST',
    });
    const data = await parseResponse<WhatsAppSendMessageResponse>(res, 'sendText');
    return { id: data.messages?.[0]?.id };
  }

  async markMessageRead(messageId: string): Promise<void> {
    const payload = {
      messaging_product: 'whatsapp',
      message_id: messageId,
      status: 'read',
    };

    const res = await fetch(`${this.apiRoot}/${encodeURIComponent(this.phoneNumberId)}/messages`, {
      body: JSON.stringify(payload),
      headers: this.authHeaders,
      method: 'POST',
    });
    await parseResponse<Record<string, unknown>>(res, 'markMessageRead');
  }

  async downloadMedia(
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType?: string; size?: number }> {
    const infoRes = await fetch(`${this.apiRoot}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      method: 'GET',
    });
    const info = await parseResponse<WhatsAppMediaInfo>(infoRes, 'getMediaInfo');
    if (!info.url) {
      throw new Error(`WhatsApp media ${mediaId} did not include a download URL`);
    }

    const mediaRes = await fetch(info.url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      method: 'GET',
    });
    if (!mediaRes.ok) {
      throw new Error(`downloadMedia ${mediaId} failed with HTTP ${mediaRes.status}`);
    }

    return {
      buffer: Buffer.from(await mediaRes.arrayBuffer()),
      mimeType: info.mime_type,
      size: info.file_size,
    };
  }

  private truncateText(text: string): string {
    // WhatsApp Cloud API text bodies are capped at 4096 characters.
    return text.length > 4096 ? text.slice(0, 4096) : text;
  }
}
