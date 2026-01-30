import { authEnv } from '@/envs/auth';

import type { GenericProviderDefinition } from '../types';

const FEISHU_AUTHORIZATION_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const FEISHU_USERINFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

type FeishuUserProfile = {
  avatar_big?: string;
  avatar_middle?: string;
  avatar_thumb?: string;
  avatar_url?: string;
  email?: string;
  en_name?: string;
  enterprise_email?: string;
  name?: string;
  open_id?: string;
  tenant_key?: string;
  union_id?: string;
};

type FeishuUserInfoResponse = {
  code?: number;
  data?: FeishuUserProfile;
  msg?: string;
};

type FeishuTokenPayload = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  tokenType?: string;
  token_type?: string;
};

type FeishuTokenResponse = {
  code?: number;
  data?: FeishuTokenPayload;
  message?: string;
  msg?: string;
} & FeishuTokenPayload;

const isFeishuProfile = (value: unknown): value is FeishuUserProfile => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.union_id === 'string' ||
    typeof candidate.open_id === 'string' ||
    typeof candidate.avatar_url === 'string' ||
    typeof candidate.name === 'string'
  );
};

const parseScopes = (scope: string | undefined) =>
  scope ? scope.split(/[\s,]+/).filter(Boolean) : [];

const provider: GenericProviderDefinition<{
  AUTH_FEISHU_APP_ID: string;
  AUTH_FEISHU_APP_SECRET: string;
}> = {
  build: (env) => {
    const clientId = env.AUTH_FEISHU_APP_ID;
    const clientSecret = env.AUTH_FEISHU_APP_SECRET;

    return {
      authorizationUrl: FEISHU_AUTHORIZATION_URL,
      authorizationUrlParams: {
        app_id: clientId,
        response_type: 'code',
        scope: 'contact:user.base:readonly contact:user.email:readonly',
      },
      clientId,
      clientSecret,
      /**
       * Exchange code directly with Feishu (no proxy needed).
       */
      getToken: async ({ code, redirectURI }) => {
        const tokenResponse = await fetch(FEISHU_TOKEN_URL, {
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectURI,
          }),
          cache: 'no-store',
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          method: 'POST',
        });

        const parsed = (await tokenResponse.json()) as FeishuTokenResponse;
        const payload = parsed.data ?? parsed;

        const hasErrorCode = typeof parsed.code === 'number' && parsed.code !== 0;
        const tokenMissing = !payload.access_token;

        if (!tokenResponse.ok || hasErrorCode || tokenMissing) {
          throw new Error(parsed.msg ?? parsed.message ?? 'Failed to fetch Feishu OAuth token');
        }

        console.log('[Feishu OAuth] Token response:', JSON.stringify(parsed, null, 2));
        console.log('[Feishu OAuth] Granted scopes:', payload.scope);

        return {
          accessToken: payload.access_token,
          accessTokenExpiresAt: payload.expires_in
            ? new Date(Date.now() + payload.expires_in * 1000)
            : undefined,
          expiresIn: payload.expires_in,
          raw: parsed,
          refreshToken: payload.refresh_token,
          scopes: parseScopes(payload.scope),
          tokenType: payload.token_type ?? payload.tokenType ?? 'Bearer',
        };
      },
      getUserInfo: async (tokens) => {
        console.log('[Feishu OAuth] getUserInfo called, accessToken:', !!tokens.accessToken);
        if (!tokens.accessToken) return null;

        const response = await fetch(FEISHU_USERINFO_URL, {
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
          },
        });

        console.log('[Feishu OAuth] User info response status:', response.status);
        if (!response.ok) return null;

        const payload = (await response.json()) as unknown;
        console.log('[Feishu OAuth] Raw payload:', JSON.stringify(payload, null, 2));

        const profileResponse = payload as FeishuUserInfoResponse;

        if (profileResponse.code && profileResponse.code !== 0) {
          console.log('[Feishu OAuth] Error code:', profileResponse.code, profileResponse.msg);
          return null;
        }

        const profile: FeishuUserProfile | undefined =
          profileResponse.data ?? (isFeishuProfile(payload) ? payload : undefined);

        console.log('[Feishu OAuth] Parsed profile:', JSON.stringify(profile, null, 2));
        if (!profile) return null;

        const unionId = profile.union_id ?? profile.open_id;
        console.log('[Feishu OAuth] unionId:', unionId);
        if (!unionId) return null;

        // Always use union_id to construct email for consistency
        // This avoids issues when:
        // 1. Admin hasn't enabled "Allow OpenAPI to access email field" in Feishu admin console
        // 2. User hasn't bound an email in Feishu
        // 3. User's email changes later (which would cause account mismatch)
        const email = `${unionId}@feishu.sso`;
        console.log('[Feishu OAuth] constructed email:', email);
        console.log('[Feishu OAuth] original profile.email:', `"${profile.email}"`);
        console.log('[Feishu OAuth] original profile.enterprise_email:', profile.enterprise_email);

        // Note: We spread profile first, then override email to ensure our constructed email is used
        // profile.email might be an empty string "" which is falsy but still a defined property
        const result = {
          ...profile,
          email, // Override profile.email with our constructed email
          emailVerified: false,
          id: unionId,
          image:
            profile.avatar_url ??
            profile.avatar_thumb ??
            profile.avatar_middle ??
            profile.avatar_big,
          name: profile.name ?? profile.en_name ?? unionId,
        };

        // Double check email is set correctly
        console.log('[Feishu OAuth] result.email after spread:', result.email);

        console.log('[Feishu OAuth] Final result:', JSON.stringify(result, null, 2));
        return result;
      },
      pkce: false,
      providerId: 'feishu',
      responseMode: 'query',
      scopes: ['contact:user.base:readonly', 'contact:user.email:readonly'],
      tokenUrl: FEISHU_TOKEN_URL,
    };
  },

  checkEnvs: () => {
    return !!(authEnv.AUTH_FEISHU_APP_ID && authEnv.AUTH_FEISHU_APP_SECRET)
      ? {
          AUTH_FEISHU_APP_ID: authEnv.AUTH_FEISHU_APP_ID,
          AUTH_FEISHU_APP_SECRET: authEnv.AUTH_FEISHU_APP_SECRET,
        }
      : false;
  },
  id: 'feishu',
  type: 'generic',
};

export default provider;
