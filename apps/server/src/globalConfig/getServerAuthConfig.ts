import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { parseSSOProviders } from '@/libs/better-auth/utils/server';
import { type GlobalServerConfig } from '@/types/serverConfig';

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
    // APP_URL always resolves to something — it falls back to localhost —
    // so the flag has to key off explicit configuration. An implicit
    // localhost origin would advertise passkeys whose rpID cannot match
    // the host the deployment is actually served from.
    enablePasskey: !!process.env.APP_URL,
    oAuthSSOProviders: getBetterAuthSSOProviders(),
    telemetry: {},
  };
};
