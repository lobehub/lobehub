import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { parseSSOProviders } from '@/libs/better-auth/utils/server';
import { type GlobalServerConfig } from '@/types/serverConfig';

/**
 * `appEnv.APP_URL` always resolves — it falls back to `http://localhost:3210`
 * outside Vercel — and it is only validated as a plain string, so it can be
 * malformed or a plain-HTTP public origin. WebAuthn needs a secure context,
 * and `getPasskeyRpID()` silently gives up when the URL cannot be parsed, so
 * the flag has to reject anything a ceremony could not actually use.
 */
const hasUsableAppOrigin = () => {
  if (!process.env.APP_URL && process.env.VERCEL !== '1') return false;

  try {
    const { hostname, protocol } = new URL(appEnv.APP_URL);

    // Loopback is a secure context even over plain HTTP.
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

    return protocol === 'https:' || isLoopback;
  } catch {
    return false;
  }
};

const getBetterAuthSSOProviders = () => {
  return parseSSOProviders(authEnv.AUTH_SSO_PROVIDERS);
};

export const getServerAuthConfig = (): GlobalServerConfig => {
  return {
    aiProvider: {},
    disableEmailPassword: authEnv.AUTH_DISABLE_EMAIL_PASSWORD,
    enableBusinessFeatures: ENABLE_BUSINESS_FEATURES,
    enableEmailVerification: authEnv.AUTH_EMAIL_VERIFICATION,
    enableMagicLink: authEnv.AUTH_ENABLE_MAGIC_LINK,
    enableMarketTrustedClient: !!(
      appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID
    ),
    enablePasskey: hasUsableAppOrigin(),
    oAuthSSOProviders: getBetterAuthSSOProviders(),
    telemetry: {},
  };
};
