/**
 * CUST-007: 服务端兑换一次性 SSO ticket（设计文档 §6）。
 *
 * 约定：
 * - 只走服务端，client_secret 永不下发前端
 * - 所有失败都抛 `SsoTicketError`，message 只有错误码，不携带 ticket/secret
 */
import {
  SsoTicketError,
  type SsoTicketConfig,
  type SsoTicketErrorCode,
  type SsoTicketProfile,
} from './types';

type FetchLike = typeof fetch;

export interface ExchangeTicketDeps {
  fetchImpl?: FetchLike;
}

interface ExchangeEnvelope {
  code?: number | string;
  data?: Record<string, unknown>;
  msg?: string;
}

/** 平台业务码 → 本地错误码；未登记的一律按 ticket 无效处理。 */
const PLATFORM_ERROR_CODES: Record<string, SsoTicketErrorCode> = {
  SSO_CLIENT_AUTH_INVALID: 'SSO_CLIENT_AUTH_INVALID',
  SSO_CLIENT_MISMATCH: 'SSO_CLIENT_MISMATCH',
  SSO_TICKET_INVALID: 'SSO_TICKET_INVALID',
  SSO_TICKET_MISSING: 'SSO_TICKET_MISSING',
  SSO_TICKET_USERINFO_INVALID: 'SSO_TICKET_USERINFO_INVALID',
};

/** 日志脱敏：只保留前 4 位与长度。 */
export function redactTicket(ticket: string): string {
  if (!ticket) return '<empty>';

  return `${ticket.slice(0, 4)}***(${ticket.length})`;
}

const asString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return;

  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const isSuccessCode = (code: number | string | undefined): boolean => code === 0 || code === '0';

export async function exchangeTicket(
  ticket: string,
  config: SsoTicketConfig,
  deps: ExchangeTicketDeps = {},
): Promise<SsoTicketProfile> {
  if (!config.exchangeUrl || !config.clientId || !config.clientSecret) {
    throw new SsoTicketError('SSO_CLIENT_AUTH_INVALID');
  }

  const fetchImpl = deps.fetchImpl ?? fetch;

  let url: URL;
  try {
    url = new URL(config.exchangeUrl);
  } catch {
    throw new SsoTicketError('SSO_EXCHANGE_UNAVAILABLE');
  }
  url.searchParams.set('ticket', ticket);

  const authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json', authorization },
      method: 'POST',
      signal: controller.signal,
    });
  } catch {
    throw new SsoTicketError('SSO_EXCHANGE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new SsoTicketError('SSO_CLIENT_AUTH_INVALID');
  }
  if (!response.ok) {
    throw new SsoTicketError('SSO_EXCHANGE_UNAVAILABLE');
  }

  let payload: ExchangeEnvelope;
  try {
    payload = (await response.json()) as ExchangeEnvelope;
  } catch {
    throw new SsoTicketError('SSO_EXCHANGE_UNAVAILABLE');
  }

  if (!isSuccessCode(payload?.code)) {
    const platformCode = typeof payload?.code === 'string' ? payload.code : undefined;
    throw new SsoTicketError((platformCode && PLATFORM_ERROR_CODES[platformCode]) || 'SSO_TICKET_INVALID');
  }

  const data = payload.data ?? {};

  if (typeof data.clientId === 'string' && data.clientId !== config.clientId) {
    throw new SsoTicketError('SSO_CLIENT_MISMATCH');
  }

  const loginDomain = asString(data.loginDomain);
  if (loginDomain && config.loginDomain && loginDomain !== config.loginDomain) {
    throw new SsoTicketError('SSO_CLIENT_MISMATCH');
  }

  const userId = asString(data.userId);
  const userCode = asString(data.userCode);
  const realName = asString(data.realName);

  if (!userId || !userCode || !realName) {
    throw new SsoTicketError('SSO_TICKET_USERINFO_INVALID');
  }

  return {
    currentTenantId: asString(data.currentTenantId),
    devOrgId: asString(data.devOrgId),
    devOrgName: asString(data.devOrgName),
    loginDomain,
    realName,
    roleCodes: asStringArray(data.roleCodes),
    userCode,
    userId,
  };
}
