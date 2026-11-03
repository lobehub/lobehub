import { authEnv } from '@/envs/auth';

import { type GenericProviderDefinition } from '../types';

const WECHAT_AUTHORIZATION_URL = 'https://open.weixin.qq.com/connect/qrconnect';
const WECHAT_TOKEN_URL = 'https://api.weixin.qq.com/sns/oauth2/access_token';
const WECHAT_USERINFO_URL = 'https://api.weixin.qq.com/sns/userinfo';

type WeChatTokenResponse = {
  access_token?: string;
  errcode?: number;
  errmsg?: string;
  expires_in?: number;
  openid?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  unionid?: string;
};

const parseWechatScopes = (scope: string | undefined) =>
  scope ? scope.split(' ').filter(Boolean) : [];

const provider: GenericProviderDefinition<{
  AUTH_WECHAT_ID: string;
  AUTH_WECHAT_SECRET: string;
}> = {
  build: (env) => {
    const clientId = env.AUTH_WECHAT_ID;
    const clientSecret = env.AUTH_WECHAT_SECRET;

    return {
      authorizationUrl: WECHAT_AUTHORIZATION_URL,
      authorizationUrlParams: {
        appid: clientId,
        response_type: 'code',
        scope: 'snsapi_login',
      },
      clientId,
      clientSecret,
      /**
       * WeChat uses a non-standard token endpoint (GET with appid/secret/code)
       * and returns openid/unionid alongside tokens, so we exchange the code
       * manually instead of proxying through a custom API route.
       */
      getToken: async ({ code }) => {
        const tokenUrl = new URL(WECHAT_TOKEN_URL);
        tokenUrl.searchParams.set('appid', clientId);
        tokenUrl.searchParams.set('secret', clientSecret);
        tokenUrl.searchParams.set('code', code);
        tokenUrl.searchParams.set('grant_type', 'authorization_code');

        const response = await fetch(tokenUrl, { cache: 'no-store' });
        const data = (await response.json()) as WeChatTokenResponse;

        if (!response.ok || data.errcode) {
          throw new Error(data.errmsg ?? 'Failed to fetch WeChat OAuth token');
        }

        if (!data.access_token || !data.openid) {
          throw new Error('WeChat token response is missing required fields');
        }

        return {
          accessToken: data.access_token,
          accessTokenExpiresAt: data.expires_in
            ? new Date(Date.now() + data.expires_in * 1000)
            : undefined,
          expiresIn: data.expires_in,
          raw: data,
          refreshToken: data.refresh_token,
          refreshTokenExpiresAt: undefined,
          scopes: parseWechatScopes(data.scope),
          tokenType: data.token_type ?? 'Bearer',
        };
      },

      /**
       * Use openid/unionid returned in the token response; no custom scope encoding needed.
       */
      getUserInfo: async (tokens) => {
        const accessToken = tokens.accessToken;
        const openId = (tokens as { raw?: WeChatTokenResponse }).raw?.openid;
        const unionId = (tokens as { raw?: WeChatTokenResponse }).raw?.unionid;

        if (!accessToken || !openId) {
          return null;
        }

        const url = new URL(WECHAT_USERINFO_URL);
        url.searchParams.set('access_token', accessToken);
        url.searchParams.set('openid', openId);
        url.searchParams.set('lang', 'zh_CN');

        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
          return null;
        }

        const profile = (await response.json()) as {
          headimgurl?: string;
          nickname?: string;
          unionid?: string;
        };

        const finalUnionId = unionId ?? profile.unionid ?? openId;
        const syntheticEmail = `${finalUnionId}@wechat.lobehub`;

        return {
          email: syntheticEmail,
          emailVerified: false,
          id: finalUnionId,
          image: profile.headimgurl,
          name: profile.nickname ?? finalUnionId,
          ...profile,
        };
      },

      pkce: false,

      providerId: 'wechat',

      responseMode: 'query',

      scopes: ['snsapi_login'],

      tokenUrl: WECHAT_TOKEN_URL,
    };
  },

  checkEnvs: () => {
    return !!(authEnv.AUTH_WECHAT_ID && authEnv.AUTH_WECHAT_SECRET)
      ? {
          AUTH_WECHAT_ID: authEnv.AUTH_WECHAT_ID,
          AUTH_WECHAT_SECRET: authEnv.AUTH_WECHAT_SECRET,
        }
      : false;
  },
  id: 'wechat',
  type: 'generic',
};

export default provider;
