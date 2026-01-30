import { authEnv } from '@/envs/auth';

import { buildOidcConfig } from '../helpers';
import type { GenericProviderDefinition } from '../types';

const provider: GenericProviderDefinition<{
  AUTH_OKTA_ID: string;
  AUTH_OKTA_ISSUER: string;
  AUTH_OKTA_SECRET: string;
}> = {
  build: (env) =>
    buildOidcConfig({
      clientId: env.AUTH_OKTA_ID,
      clientSecret: env.AUTH_OKTA_SECRET,
      issuer: env.AUTH_OKTA_ISSUER,
      label: env.label,
      overrides: {
        mapProfileToUser: (profile) => ({
          email: profile.email,
          name: profile.name ?? profile.preferred_username ?? profile.email ?? profile.sub,
        }),
      },
      providerId: 'okta',
    }),
  checkEnvs: () => {
    return !!(authEnv.AUTH_OKTA_ID && authEnv.AUTH_OKTA_SECRET && authEnv.AUTH_OKTA_ISSUER)
      ? {
          AUTH_OKTA_ID: authEnv.AUTH_OKTA_ID,
          AUTH_OKTA_ISSUER: authEnv.AUTH_OKTA_ISSUER,
          AUTH_OKTA_SECRET: authEnv.AUTH_OKTA_SECRET,
          label: authEnv.AUTH_OKTA_LABEL,
        }
      : false;
  },
  id: 'okta',
  type: 'generic',
};

export default provider;
