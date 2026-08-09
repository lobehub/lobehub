import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { parseSSOProviders } from '@/libs/better-auth/utils/server';
import { type GlobalServerConfig } from '@/types/serverConfig';

/**
 * `appEnv.APP_URL` always resolves — it falls back to `http://localhost:3210`
 * outside Vercel — so a plain truthiness check would advertise passkeys on
 * deployments whose rpID cannot match the host they are served from.
 *
 * An explicitly set APP_URL counts, and so does the URL Vercel derives from
 * its own platform variables. Only the implicit localhost fallback does not.
 */
const hasConfiguredAppUrl = () => !!process.env.APP_URL || process.env.VERCEL === '1';

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
    enablePasskey: hasConfiguredAppUrl(),
    oAuthSSOProviders: getBetterAuthSSOProviders(),
    telemetry: {},
  };
};
