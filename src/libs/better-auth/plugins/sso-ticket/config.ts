/**
 * CUST-007: SSO ticket 配置。
 *
 * 刻意不扩展 `packages/env/src/auth.ts`（上游高频改动文件），改为在本模块内直接读取
 * `process.env` 并自行校验，减少合并冲突。缺配置时不在导入期抛错，避免整站启动失败。
 */
import {
  SSO_TICKET_DEFAULT_EMAIL_DOMAIN,
  SSO_TICKET_DEFAULT_REDIRECT,
  SSO_TICKET_DEFAULT_TIMEOUT_MS,
  SSO_TICKET_PROVIDER_ID,
  type SsoTicketConfig,
} from './types';

type EnvSource = Record<string, string | undefined>;

const read = (env: EnvSource, key: string): string | undefined => {
  const value = env[key]?.trim();

  return value ? value : undefined;
};

const parseTimeout = (value: string | undefined): number => {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : SSO_TICKET_DEFAULT_TIMEOUT_MS;
};

export function getSsoTicketConfig(env: EnvSource = process.env): SsoTicketConfig {
  const requested = read(env, 'AUTH_SSO_TICKET_ENABLED') === '1';
  const clientId = read(env, 'AUTH_SSO_TICKET_CLIENT_ID');
  const clientSecret = read(env, 'AUTH_SSO_TICKET_CLIENT_SECRET');
  const exchangeUrl = read(env, 'AUTH_SSO_TICKET_EXCHANGE_URL');

  const missing: string[] = [];
  if (requested) {
    if (!clientId) missing.push('AUTH_SSO_TICKET_CLIENT_ID');
    if (!clientSecret) missing.push('AUTH_SSO_TICKET_CLIENT_SECRET');
    if (!exchangeUrl) missing.push('AUTH_SSO_TICKET_EXCHANGE_URL');
  }

  return {
    clientId,
    clientSecret,
    defaultRedirect: read(env, 'AUTH_SSO_TICKET_DEFAULT_REDIRECT') ?? SSO_TICKET_DEFAULT_REDIRECT,
    emailDomain: read(env, 'AUTH_SSO_TICKET_EMAIL_DOMAIN') ?? SSO_TICKET_DEFAULT_EMAIL_DOMAIN,
    enabled: requested && missing.length === 0,
    exchangeUrl,
    loginDomain: read(env, 'AUTH_SSO_TICKET_LOGIN_DOMAIN'),
    missing,
    providerId: read(env, 'AUTH_SSO_TICKET_PROVIDER_ID') ?? SSO_TICKET_PROVIDER_ID,
    requested,
    timeoutMs: parseTimeout(read(env, 'AUTH_SSO_TICKET_TIMEOUT_MS')),
  };
}

/** 供启动日志使用；未开启或配置完整时返回 undefined。 */
export function describeSsoTicketMisconfiguration(config: SsoTicketConfig): string | undefined {
  if (!config.requested || config.missing.length === 0) return;

  return `[sso-ticket] AUTH_SSO_TICKET_ENABLED=1 but missing: ${config.missing.join(', ')}`;
}
