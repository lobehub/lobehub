/**
 * CUST-007: Better Auth 插件，暴露 `GET /api/auth/sso-ticket/callback`。
 *
 * 设计要点（合并上游时的接点）：
 * - 端点路径拼上 Better Auth 默认 basePath `/api/auth`，正好是设计文档要求的 callback 地址
 * - 会话通过 `internalAdapter.createSession` + 官方 `setSessionCookie` 建立，不自造 cookie
 * - 未启用时返回空插件，默认部署行为零变化
 */
import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { type BetterAuthPlugin } from 'better-auth/types';
import { z } from 'zod';

import { describeSsoTicketMisconfiguration, getSsoTicketConfig } from './config';
import { exchangeTicket } from './exchange';
import { requestTicket } from './requestTicket';
import { resolveSafeRedirect } from './redirect';
import {
  SsoTicketError,
  type SsoTicketConfig,
  type SsoTicketErrorCode,
  type SsoTicketProfile,
} from './types';
import {
  buildSsoAccountInput,
  buildSsoUserInput,
  generateSsoEmail,
  type SsoAccountInput,
  type SsoUserInput,
} from './userMapping';

const callbackQuerySchema = z.object({
  redirect: z.string().optional(),
  ticket: z.string().optional(),
  /** 部分平台不生成 ticket，直接把当前用户 token 放进 callback。 */
  token: z.string().optional(),
});

export interface SsoUserRecord {
  banned?: boolean | null;
  fullName?: string | null;
  id: string;
  username?: string | null;
}

export interface SsoAccountLookup {
  linkedAccount: unknown | null;
  user: SsoUserRecord;
}

/** 只声明本插件用到的 internalAdapter 方法，避免绑定 better-auth 内部类型细节。 */
export interface SsoTicketInternalAdapter {
  createSession: (userId: string) => Promise<unknown>;
  createUser: (user: SsoUserInput) => Promise<SsoUserRecord>;
  findOAuthUser: (
    email: string,
    accountId: string,
    providerId: string,
  ) => Promise<SsoAccountLookup | null>;
  linkAccount: (account: SsoAccountInput) => Promise<unknown>;
  updateUser: (userId: string, data: Record<string, unknown>) => Promise<SsoUserRecord>;
}

export interface SsoTicketEndpointContext {
  context: {
    internalAdapter: SsoTicketInternalAdapter;
    logger: { error: (...args: unknown[]) => void };
  };
  query: { redirect?: string; ticket?: string; token?: string };
  /** better-auth 的 ctx.redirect 会抛出 Response，这里按同样语义使用。 */
  redirect: (url: string) => unknown;
}

export interface SsoTicketRuntime {
  config: SsoTicketConfig;
  exchange: (ticket: string, config: SsoTicketConfig) => Promise<SsoTicketProfile>;
  requestTicket: (token: string, config: SsoTicketConfig) => Promise<string>;
  setSessionCookie: (ctx: unknown, payload: { session: unknown; user: SsoUserRecord }) => Promise<void>;
}

async function syncProfile(
  internal: SsoTicketInternalAdapter,
  user: SsoUserRecord,
  profile: SsoTicketProfile,
): Promise<SsoUserRecord> {
  const patch: Record<string, unknown> = {};

  if (profile.userCode && user.username !== profile.userCode) patch.username = profile.userCode;
  if (profile.realName && user.fullName !== profile.realName) patch.fullName = profile.realName;

  if (Object.keys(patch).length === 0) return user;

  return internal.updateUser(user.id, patch);
}

/**
 * 查用户 → 建绑定 → 建会话。
 *
 * 查找顺序：先 providerId + userId（账号绑定），再按邮箱兜底。这样工号变更后
 * 仍然进入同一个 LobeHub 用户（设计文档 §7/§8）。
 */
export async function resolveSsoUser(
  internal: SsoTicketInternalAdapter,
  profile: SsoTicketProfile,
  config: SsoTicketConfig,
): Promise<{ session: unknown; user: SsoUserRecord }> {
  const email = generateSsoEmail(profile.userCode, config.emailDomain);
  const found = await internal.findOAuthUser(email, profile.userId, config.providerId);

  let user: SsoUserRecord;

  if (found) {
    user = found.user;
    if (!found.linkedAccount) {
      await internal.linkAccount(buildSsoAccountInput(profile, user.id, config.providerId));
    }
    user = await syncProfile(internal, user, profile);
  } else {
    try {
      user = await internal.createUser(buildSsoUserInput(profile, config));
      await internal.linkAccount(buildSsoAccountInput(profile, user.id, config.providerId));
    } catch (error) {
      // 并发首登兜底：另一个请求可能刚创建了同样账号，重查一次而不是直接失败。
      const retry = await internal.findOAuthUser(email, profile.userId, config.providerId);
      if (!retry) throw error;

      user = await syncProfile(internal, retry.user, profile);
      if (!retry.linkedAccount) {
        await internal.linkAccount(buildSsoAccountInput(profile, user.id, config.providerId));
      }
    }
  }

  if (user.banned) throw new SsoTicketError('SSO_USER_DISABLED');

  const session = await internal.createSession(user.id);

  return { session, user };
}

/**
 * callback 主流程。无论成功失败都以重定向结束，ticket 不会出现在跳转地址里。
 */
export async function runSsoTicketCallback(
  ctx: SsoTicketEndpointContext,
  runtime: SsoTicketRuntime,
): Promise<never> {
  const redirectTarget = resolveSafeRedirect(ctx.query.redirect, runtime.config.defaultRedirect);

  let failure: SsoTicketErrorCode | undefined;

  try {
    let ticket = ctx.query.ticket?.trim();

    if (!ticket) {
      const token = ctx.query.token?.trim();
      if (!token) throw new SsoTicketError('SSO_TICKET_MISSING');

      // 平台直接给 token 的场景：服务端先换 ticket，再走同一条 exchange 链路。
      ticket = await runtime.requestTicket(token, runtime.config);
    }

    const profile = await runtime.exchange(ticket, runtime.config);
    const { session, user } = await resolveSsoUser(ctx.context.internalAdapter, profile, runtime.config);

    await runtime.setSessionCookie(ctx, { session, user });
  } catch (error) {
    failure = error instanceof SsoTicketError ? error.code : 'SSO_EXCHANGE_UNAVAILABLE';

    if (
      failure === 'SSO_CLIENT_AUTH_INVALID' ||
      failure === 'SSO_EXCHANGE_UNAVAILABLE' ||
      failure === 'SSO_TICKET_CREATE_UNAVAILABLE' ||
      failure === 'SSO_TOKEN_INVALID'
    ) {
      ctx.context.logger.error(`[sso-ticket] callback failed: ${failure}`);
    }
  }

  if (failure) throw ctx.redirect(`/auth-error?error=${failure}`);

  throw ctx.redirect(redirectTarget);
}

export interface SsoTicketPluginOptions {
  config?: SsoTicketConfig;
  exchange?: SsoTicketRuntime['exchange'];
  requestTicket?: SsoTicketRuntime['requestTicket'];
  setSessionCookie?: SsoTicketRuntime['setSessionCookie'];
}

export const ssoTicket = (options: SsoTicketPluginOptions = {}): BetterAuthPlugin => {
  const config = options.config ?? getSsoTicketConfig();

  const misconfiguration = describeSsoTicketMisconfiguration(config);
  if (misconfiguration) console.warn(misconfiguration);

  if (!config.enabled) return { id: 'sso-ticket' };

  const runtime: SsoTicketRuntime = {
    config,
    exchange: options.exchange ?? exchangeTicket,
    requestTicket: options.requestTicket ?? requestTicket,
    setSessionCookie:
      options.setSessionCookie ??
      ((ctx, payload) =>
        setSessionCookie(
          ctx as Parameters<typeof setSessionCookie>[0],
          payload as Parameters<typeof setSessionCookie>[1],
        )),
  };

  return {
    endpoints: {
      ssoTicketCallback: createAuthEndpoint(
        '/sso-ticket/callback',
        { method: 'GET', query: callbackQuerySchema },
        async (ctx) => runSsoTicketCallback(ctx as unknown as SsoTicketEndpointContext, runtime),
      ),
    },
    id: 'sso-ticket',
    rateLimit: [
      {
        max: 10,
        pathMatcher: (path) => path === '/sso-ticket/callback',
        window: 60,
      },
    ],
  };
};
