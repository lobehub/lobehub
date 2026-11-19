/**
 * CUST-007: 统一认证平台 SSO_TICKET 接入（独立模块，合并上游时零冲突）。
 *
 * 协议说明见设计文档 §5–§8。这里只放纯类型与错误码，不引用 better-auth 或数据库，
 * 便于单测。
 */

export const SSO_TICKET_PROVIDER_ID = 'tellhow-sso';

export const SSO_TICKET_DEFAULT_EMAIL_DOMAIN = 'tellhow.com';
export const SSO_TICKET_DEFAULT_REDIRECT = '/';
export const SSO_TICKET_DEFAULT_TIMEOUT_MS = 5000;

export type SsoTicketErrorCode =
  | 'SSO_CLIENT_AUTH_INVALID'
  | 'SSO_CLIENT_MISMATCH'
  | 'SSO_EXCHANGE_UNAVAILABLE'
  | 'SSO_TICKET_INVALID'
  | 'SSO_TICKET_MISSING'
  | 'SSO_TICKET_USERINFO_INVALID'
  | 'SSO_USER_DISABLED';

/**
 * 错误信息只保留错误码，避免把 ticket、client_secret 或平台返回体带进日志。
 */
export class SsoTicketError extends Error {
  readonly code: SsoTicketErrorCode;

  constructor(code: SsoTicketErrorCode) {
    super(code);
    this.code = code;
    this.name = 'SsoTicketError';
  }
}

export interface SsoTicketProfile {
  currentTenantId?: string;
  devOrgId?: string;
  devOrgName?: string;
  loginDomain?: string;
  realName: string;
  roleCodes: string[];
  userCode: string;
  userId: string;
}

export interface SsoTicketConfig {
  clientId?: string;
  clientSecret?: string;
  defaultRedirect: string;
  emailDomain: string;
  enabled: boolean;
  exchangeUrl?: string;
  loginDomain?: string;
  /** 已开启但缺失的配置项名称，便于启动日志提示。 */
  missing: string[];
  providerId: string;
  /** 是否通过 AUTH_SSO_TICKET_ENABLED=1 显式开启。 */
  requested: boolean;
  timeoutMs: number;
}
