/**
 * CUST-007: 平台用户资料 → LobeHub 用户/账号字段映射（纯函数）。
 *
 * 设计文档 §7/§8：
 * - 外部身份主键永远是 providerId + userId，email 只用于兼容 Better Auth 用户模型
 * - 工号生成固定邮箱：A123456 -> a123456@tellhow.com
 */
import { SsoTicketError, type SsoTicketConfig, type SsoTicketProfile } from './types';

const UNSAFE_USER_CODE_CHARS = /[^a-z0-9.-]/g;

export function normalizeUserCode(raw: string | undefined): string {
  if (!raw) return '';

  return raw.trim().toLowerCase().replace(UNSAFE_USER_CODE_CHARS, '');
}

export function generateSsoEmail(userCode: string | undefined, domain: string): string {
  const normalized = normalizeUserCode(userCode);
  if (!normalized) throw new SsoTicketError('SSO_TICKET_USERINFO_INVALID');

  return `${normalized}@${domain.trim().toLowerCase()}`;
}

export interface SsoUserInput {
  email: string;
  emailVerified: boolean;
  fullName: string;
  name: string;
  username: string;
}

export function buildSsoUserInput(profile: SsoTicketProfile, config: SsoTicketConfig): SsoUserInput {
  const username = profile.userCode.trim();
  if (!username) throw new SsoTicketError('SSO_TICKET_USERINFO_INVALID');

  return {
    email: generateSsoEmail(username, config.emailDomain),
    emailVerified: true,
    fullName: profile.realName,
    name: profile.realName,
    username,
  };
}

export interface SsoAccountInput {
  accountId: string;
  providerId: string;
  userId: string;
}

export function buildSsoAccountInput(
  profile: SsoTicketProfile,
  userId: string,
  providerId: string,
): SsoAccountInput {
  if (!profile.userId) throw new SsoTicketError('SSO_TICKET_USERINFO_INVALID');

  return { accountId: profile.userId, providerId, userId };
}
