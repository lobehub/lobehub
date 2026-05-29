import { normalizePhoneDigits } from './phone';

export interface WatiWebhookEndpoint {
  channelPhoneNumber?: string;
  eventTypes?: string[];
  id?: string;
  phoneNumber?: string;
  status?: number;
  url?: string;
}

export const normalizeWebhookUrl = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const normalized = parsed.toString();
    return normalized.endsWith('/') && parsed.pathname === '/'
      ? normalized.slice(0, -1)
      : normalized.replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

export const webhookPhoneDigits = (endpoint: WatiWebhookEndpoint): string => {
  const raw = endpoint.channelPhoneNumber ?? endpoint.phoneNumber ?? '';
  return normalizePhoneDigits(raw);
};

export const findWebhookForPhoneAndUrl = (
  endpoints: WatiWebhookEndpoint[],
  phoneNumber: string,
  webhookUrl: string,
): WatiWebhookEndpoint | undefined => {
  const targetUrl = normalizeWebhookUrl(webhookUrl);
  const targetPhone = normalizePhoneDigits(phoneNumber);
  if (!targetPhone || !targetUrl) return undefined;

  return endpoints.find((endpoint) => {
    const epPhone = webhookPhoneDigits(endpoint);
    const epUrl = endpoint.url ? normalizeWebhookUrl(endpoint.url) : '';
    return epPhone === targetPhone && epUrl === targetUrl;
  });
};

export const extractWebhookListFromResponse = (json: unknown): WatiWebhookEndpoint[] => {
  if (!json || typeof json !== 'object') return [];
  const record = json as Record<string, unknown>;
  const raw = record.result ?? record.webhookEndpoints ?? record.data;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object') as WatiWebhookEndpoint[];
};

export const parseWatiJsonBody = (text: string): Record<string, unknown> | undefined => {
  try {
    const json: unknown = JSON.parse(text);
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

export const isOverWebhookLimitResponse = (body: Record<string, unknown> | undefined): boolean =>
  body?.isOverWebhookLimit === true;

export const isWebhookAlreadyExistsResponse = (
  body: Record<string, unknown> | undefined,
): boolean => body?.isWebhookExist === true;
