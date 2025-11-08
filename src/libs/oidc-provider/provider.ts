import type { EmailAddress } from '@clerk/backend';
import { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';
import Provider, { Configuration, KoaContextWithOIDC, errors } from 'oidc-provider';
import urlJoin from 'url-join';

import { serverDBEnv } from '@/config/db';
import { enableClerk } from '@/const/auth';
import { UserModel } from '@/database/models/user';
import { appEnv } from '@/envs/app';
import { getJWKS } from '@/libs/oidc-provider/jwt';
import { normalizeLocale } from '@/locales/resources';

import { DrizzleAdapter } from './adapter';
import { defaultClaims, defaultClients, defaultScopes } from './config';
import { createInteractionPolicy } from './interaction-policy';

const logProvider = debug('lobe-oidc:provider'); // <--- 添加 provider 日志实例

const MARKET_CLIENT_ID = 'lobehub-market';

const resolveClerkAccount = async (accountId: string) => {
  if (!enableClerk) return undefined;

  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();
    const user = await client.users.getUser(accountId);

    if (!user) {
      logProvider('Clerk user not found for accountId: %s', accountId);
      return undefined;
    }

    const pickName = () =>
      user.fullName ||
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      user.username ||
      user.id;

    const primaryEmail = user.primaryEmailAddressId
      ? user.emailAddresses.find((item: EmailAddress) => item.id === user.primaryEmailAddressId)
      : user.emailAddresses.at(0);

    return {
      accountId: user.id,
      async claims(_use: string, scope: string) {
        const scopeSet = new Set((scope || '').split(/\s+/).filter(Boolean));
        const claims: { [key: string]: any; sub: string } = { sub: user.id };

        if (scopeSet.has('profile')) {
          claims.name = pickName();
          if (user.imageUrl) claims.picture = user.imageUrl;
        }

        if (scopeSet.has('email') && primaryEmail) {
          claims.email = primaryEmail.emailAddress;
          claims.email_verified = primaryEmail.verification?.status === 'verified' || false;
        }

        return claims;
      },
    };
  } catch (error) {
    logProvider('Error resolving Clerk account for %s: %O', accountId, error);
    return undefined;
  }
};

export const API_AUDIENCE = 'urn:lobehub:chat'; // <-- 把这里换成你自己的 API 标识符

/**
 * 获取 Cookie 密钥，使用 KEY_VAULTS_SECRET
 */
const getCookieKeys = () => {
  const key = serverDBEnv.KEY_VAULTS_SECRET;
  if (!key) {
    throw new Error('KEY_VAULTS_SECRET is required for OIDC Provider cookie encryption');
  }
  return [key];
};

/**
 * 创建 OIDC Provider 实例
 * @param db - 数据库实例
 * @returns 配置好的 OIDC Provider 实例
 */
export const createOIDCProvider = async (db: LobeChatDatabase): Promise<Provider> => {
  // 获取 JWKS
  const jwks = getJWKS();

  const cookieKeys = getCookieKeys();

  const configuration: Configuration = {
    // 11. 数据库适配器
    adapter: DrizzleAdapter.createAdapterFactory(db),

    // 4. Claims 定义
    claims: defaultClaims,

    // 新增：客户端 CORS 控制逻辑
    clientBasedCORS(ctx, origin, client) {
      // 检查客户端是否允许此来源
      // 一个常见的策略是允许所有已注册的 redirect_uris 的来源
      if (!client || !client.redirectUris) {
        logProvider('clientBasedCORS: No client or redirectUris found, denying origin: %s', origin);
        return false; // 如果没有客户端或重定向URI，则拒绝
      }

      const allowed = client.redirectUris.some((uri) => {
        try {
          // 比较来源 (scheme, hostname, port)
          return new URL(uri).origin === origin;
        } catch {
          // 如果 redirect_uri 不是有效的 URL (例如自定义协议)，则跳过
          return false;
        }
      });

      logProvider(
        'clientBasedCORS check for origin [%s] and client [%s]: %s',
        origin,
        client.clientId,
        allowed ? 'Allowed' : 'Denied',
      );
      return allowed;
    },

    // 1. 客户端配置
    clients: defaultClients,

    // 新增：确保 ID Token 包含所有 scope 对应的 claims，而不仅仅是 openid scope
    conformIdTokenClaims: false,

    // 7. Cookie 配置
    cookies: {
      keys: cookieKeys,
      long: { path: '/', signed: true },
      short: { path: '/', signed: true },
    },

    // 5. 特性配置
    features: {
      backchannelLogout: { enabled: true },
      clientCredentials: { enabled: false },
      devInteractions: { enabled: false },
      deviceFlow: { enabled: false },
      introspection: { enabled: true },
      resourceIndicators: {
        defaultResource: () => API_AUDIENCE,
        enabled: true,

        getResourceServerInfo: (ctx, resourceIndicator) => {
          logProvider('getResourceServerInfo called with indicator: %s', resourceIndicator); // <-- 添加这行日志
          if (resourceIndicator === API_AUDIENCE) {
            logProvider('Indicator matches API_AUDIENCE, returning JWT config.'); // <-- 添加这行日志
            return {
              accessTokenFormat: 'jwt',
              audience: API_AUDIENCE,
              scope: ctx.oidc.client?.scope || 'read',
            };
          }

          logProvider('Indicator does not match API_AUDIENCE, throwing InvalidTarget.'); // <-- 添加这行日志
          throw new errors.InvalidTarget();
        },
        // 当客户端使用刷新令牌请求新的访问令牌但没有指定资源时，授权服务器会检查原始授权中包含的所有资源，并将这些资源用于新的访问令牌。这提供了一种便捷的方式来维持授权一致性，而不需要客户端在每次刷新时重新指定所有资源
        useGrantedResource: () => true,
      },
      revocation: { enabled: true },
      rpInitiatedLogout: { enabled: true },
      userinfo: { enabled: true },
    },
    // 10. 账户查找
    async findAccount(ctx: KoaContextWithOIDC, id: string) {
      logProvider('findAccount called for id: %s', id);

      // 检查是否有预先存储的外部账户 ID
      // @ts-ignore - 自定义属性
      const externalAccountId = ctx.externalAccountId;
      if (externalAccountId) {
        logProvider('Found externalAccountId in context: %s', externalAccountId);
      }

      // 确定要查找的账户 ID
      // 优先级: 1. externalAccountId 2. ctx.oidc.session?.accountId 3. 传入的 id
      const accountIdToFind = externalAccountId || ctx.oidc?.session?.accountId || id;

      const clientId = ctx.oidc?.client?.clientId;

      logProvider('OIDC request client id: %s', clientId);

      if (clientId === MARKET_CLIENT_ID) {
        logProvider('Using Clerk account resolution for marketplace client');

        if (!accountIdToFind) {
          logProvider('No account id available for Clerk resolution, returning undefined');
          return undefined;
        }

        const clerkAccount = await resolveClerkAccount(accountIdToFind);

        if (clerkAccount) {
          logProvider('Clerk account resolved successfully for %s', accountIdToFind);
          return clerkAccount;
        }

        logProvider('Clerk account resolution failed for %s', accountIdToFind);
        return undefined;
      }

      logProvider(
        'Attempting to find account with ID: %s (source: %s)',
        accountIdToFind,
        externalAccountId
          ? 'externalAccountId'
          : ctx.oidc?.session?.accountId
            ? 'oidc_session'
            : 'parameter_id',
      );

      // 如果没有可用的 ID，返回 undefined
      if (!accountIdToFind) {
        logProvider('findAccount: No account ID available, returning undefined.');
        return undefined;
      }

      try {
        const user = await UserModel.findById(db, accountIdToFind);
        logProvider(
          'UserModel.findById result for %s: %O',
          accountIdToFind,
          user ? { id: user.id, name: user.username } : null,
        );

        if (!user) {
          logProvider('No user found for accountId: %s', accountIdToFind);
          return undefined;
        }

        return {
          accountId: user.id,
          async claims(use, scope): Promise<{ [key: string]: any; sub: string }> {
            logProvider('claims function called for user %s with scope: %s', user.id, scope);
            const claims: { [key: string]: any; sub: string } = {
              sub: user.id,
            };

            if (scope.includes('profile')) {
              claims.name =
                user.fullName ||
                user.username ||
                `${user.firstName || ''} ${user.lastName || ''}`.trim();
              claims.picture = user.avatar;
            }

            if (scope.includes('email')) {
              claims.email = user.email;
              claims.email_verified = !!user.emailVerifiedAt;
            }

            logProvider('Returning claims: %O', claims);
            return claims;
          },
        };
      } catch (error) {
        logProvider('Error finding account or generating claims: %O', error);
        console.error('Error finding account:', error);
        return undefined;
      }
    },

    // 9. 交互策略
    interactions: {
      policy: createInteractionPolicy(),
      url(ctx, interaction) {
        // ---> 添加日志 <---
        logProvider('interactions.url function called');
        logProvider('Interaction details: %O', interaction);

        // 读取 OIDC 请求中的 ui_locales 参数（空格分隔的语言优先级）
        // https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest
        const uiLocalesRaw = (interaction.params?.ui_locales || ctx.oidc?.params?.ui_locales) as
          | string
          | undefined;

        let query = '';
        if (uiLocalesRaw) {
          // 取第一个优先语言，规范化到站点支持的标签
          const first = uiLocalesRaw.split(/[\s,]+/).find(Boolean);
          const hl = normalizeLocale(first);
          query = `?hl=${encodeURIComponent(hl)}`;
          logProvider('Detected ui_locales=%s -> using hl=%s', uiLocalesRaw, hl);
        } else {
          logProvider('No ui_locales provided in authorization request');
        }

        const interactionUrl = `/oauth/consent/${interaction.uid}${query}`;
        logProvider('Generated interaction URL: %s', interactionUrl);
        // ---> 添加日志结束 <---
        return interactionUrl;
      },
    },

    // 6. 密钥配置 - 使用 RS256 JWKS
    jwks: jwks as { keys: any[] },

    // 2. PKCE 配置
    pkce: {
      required: () => true,
    },

    // 12. 其他配置
    renderError: async (ctx, out, error) => {
      ctx.type = 'html';
      ctx.body = `
        <html>
          <head>
            <title>LobeHub OIDC Error</title>
          </head>
          <body>
            <h1>LobeHub OIDC Error</h1>
            <p>${JSON.stringify(error, null, 2)}</p>
            <p>${JSON.stringify(out, null, 2)}</p>
          </body>
        </html>
      `;
    },

    // 新增：启用 Refresh Token 轮换
    rotateRefreshToken: true,

    routes: {
      authorization: '/oidc/auth',
      end_session: '/oidc/session/end',
      token: '/oidc/token',
    },
    // 3. Scopes 定义
    scopes: defaultScopes,

    // 8. 令牌有效期
    ttl: {
      AccessToken: 25 * 3600, // 25 hour
      AuthorizationCode: 600, // 10 minutes
      DeviceCode: 600, // 10 minutes (if enabled)

      IdToken: 3600, // 1 hour
      Interaction: 3600, // 1 hour

      RefreshToken: 30 * 24 * 60 * 60, // 30 days
      Session: 30 * 24 * 60 * 60, // 30 days
    },
  };

  // 创建提供者实例
  const baseUrl = urlJoin(appEnv.APP_URL!, '/oidc');

  const provider = new Provider(baseUrl, configuration);
  provider.proxy = true;

  provider.on('server_error', (ctx, err) => {
    logProvider('OIDC Provider Server Error: %O', err); // Use logProvider
    console.error('OIDC Provider Error:', err);
  });

  provider.on('authorization.success', (ctx) => {
    logProvider('Authorization successful for client: %s', ctx.oidc.client?.clientId); // Use logProvider
  });

  return provider;
};

export { type default as OIDCProvider } from 'oidc-provider';
