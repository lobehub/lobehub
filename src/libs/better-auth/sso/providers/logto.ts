import { authEnv } from '@/envs/auth';

import { buildOidcConfig } from '../helpers';
import { type GenericProviderDefinition } from '../types';

const provider: GenericProviderDefinition<{
  AUTH_LOGTO_ID: string;
  AUTH_LOGTO_ISSUER: string;
  AUTH_LOGTO_SECRET: string;
}> = {
  build: (env) =>
    buildOidcConfig({
      clientId: env.AUTH_LOGTO_ID,
      clientSecret: env.AUTH_LOGTO_SECRET,
      issuer: env.AUTH_LOGTO_ISSUER,
      overrides: {
        mapProfileToUser: (profile) => ({
          email: profile.email,
          name: profile.name ?? profile.username ?? profile.email ?? profile.sub,
        }),
      },
      providerId: 'logto',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
    }),
  checkEnvs: () => {
    return !!(authEnv.AUTH_LOGTO_ID && authEnv.AUTH_LOGTO_SECRET && authEnv.AUTH_LOGTO_ISSUER)
      ? {
          AUTH_LOGTO_ID: authEnv.AUTH_LOGTO_ID,
          AUTH_LOGTO_ISSUER: authEnv.AUTH_LOGTO_ISSUER,
          AUTH_LOGTO_SECRET: authEnv.AUTH_LOGTO_SECRET,
        }
      : false;
  },
  id: 'logto',
  type: 'generic',
};

export default provider;
