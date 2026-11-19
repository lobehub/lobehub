/**
 * CUST-007: 门户直接把平台 token 传进 callback 时，由服务端补一次 ticket/create。
 *
 * 对接现状（与设计文档 §4 的差异）：平台不预先创建 ticket，而是把当前用户的
 * token 放在 URL 上，要求 LobeHub 自己换 ticket。token 只在本函数内使用，
 * 不落日志、不回传浏览器。
 */
import { isSsoTicketTokenFlowConfigured } from './config';
import { SsoTicketError, type SsoTicketConfig } from './types';

type FetchLike = typeof fetch;

export interface RequestTicketDeps {
  fetchImpl?: FetchLike;
}

interface TicketCreateEnvelope {
  code?: number | string;
  data?: Record<string, unknown>;
  msg?: string;
}

const TOKEN_ERROR_CODES = new Set(['INVALID_TOKEN', 'SSO_TOKEN_INVALID', 'UNAUTHORIZED']);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return;

  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
};

/** 兼容平台只给 redirectUrl 的情况：从 `?ticket=` 里取出来。 */
function extractTicketFromRedirect(redirectUrl: string | undefined): string | undefined {
  if (!redirectUrl) return;

  try {
    const parsed = new URL(redirectUrl);

    return asString(parsed.searchParams.get('ticket') ?? undefined);
  } catch {
    return;
  }
}

const isSuccessCode = (code: number | string | undefined): boolean => code === 0 || code === '0';

export async function requestTicket(
  token: string,
  config: SsoTicketConfig,
  deps: RequestTicketDeps = {},
): Promise<string> {
  if (!isSsoTicketTokenFlowConfigured(config)) {
    throw new SsoTicketError('SSO_CLIENT_AUTH_INVALID');
  }

  const fetchImpl = deps.fetchImpl ?? fetch;

  let url: URL;
  try {
    url = new URL(config.createUrl!);
  } catch {
    throw new SsoTicketError('SSO_TICKET_CREATE_UNAVAILABLE');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, {
      body: JSON.stringify({
        clientId: config.clientId,
        ...(config.loginDomain && { loginDomain: config.loginDomain }),
        redirectUri: config.redirectUri,
      }),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
  } catch {
    throw new SsoTicketError('SSO_TICKET_CREATE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new SsoTicketError('SSO_TOKEN_INVALID');
  }
  if (!response.ok) {
    throw new SsoTicketError('SSO_TICKET_CREATE_UNAVAILABLE');
  }

  let payload: TicketCreateEnvelope;
  try {
    payload = (await response.json()) as TicketCreateEnvelope;
  } catch {
    throw new SsoTicketError('SSO_TICKET_CREATE_UNAVAILABLE');
  }

  if (!isSuccessCode(payload?.code)) {
    const platformCode = typeof payload?.code === 'string' ? payload.code : undefined;
    throw new SsoTicketError(
      platformCode && TOKEN_ERROR_CODES.has(platformCode)
        ? 'SSO_TOKEN_INVALID'
        : 'SSO_TICKET_CREATE_UNAVAILABLE',
    );
  }

  const data = payload.data ?? {};

  if (typeof data.clientId === 'string' && data.clientId !== config.clientId) {
    throw new SsoTicketError('SSO_CLIENT_MISMATCH');
  }

  const loginDomain = asString(data.loginDomain);
  if (loginDomain && config.loginDomain && loginDomain !== config.loginDomain) {
    throw new SsoTicketError('SSO_CLIENT_MISMATCH');
  }

  const ticket = asString(data.ticket) ?? extractTicketFromRedirect(asString(data.redirectUrl));
  if (!ticket) throw new SsoTicketError('SSO_TICKET_CREATE_UNAVAILABLE');

  return ticket;
}
