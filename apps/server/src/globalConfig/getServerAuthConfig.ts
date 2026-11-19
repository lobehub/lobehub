import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import { appEnv } from '@/envs/app';
import { type GlobalServerConfig } from '@/types/serverConfig';

import { getLoginMethods } from './loginMethods';

export const getServerAuthConfig = async (): Promise<GlobalServerConfig> => {
  const loginMethods = await getLoginMethods();

  return {
    aiProvider: {},
    ...(appEnv.APP_URL ? { appUrl: appEnv.APP_URL.replace(/\/+$/, '') } : undefined),
    disableEmailPassword: !loginMethods.emailPassword,
    enableBusinessFeatures: ENABLE_BUSINESS_FEATURES,
    enableEmailVerification: loginMethods.requireEmailVerification,
    enableMagicLink: loginMethods.magicLink,
    enableMarketTrustedClient: !!(
      appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID
    ),
    // SSO providers belong to a tenant (`sso_providers`, spec A8); the auth
    // config endpoint fills them in for the tenant being signed in to.
    oAuthSSOProviders: [],
    telemetry: {},
  };
};
