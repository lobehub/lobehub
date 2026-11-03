import { authEnv } from '@/envs/auth';

import { buildOidcConfig } from '../helpers';
import { type GenericProviderDefinition } from '../types';

const provider: GenericProviderDefinition<{
  AUTH_AUTHELIA_ID: string;
  AUTH_AUTHELIA_ISSUER: string;
  AUTH_AUTHELIA_SECRET: string;
}> = {
  build: (env) =>
    buildOidcConfig({
      clientId: env.AUTH_AUTHELIA_ID,
      clientSecret: env.AUTH_AUTHELIA_SECRET,
      issuer: env.AUTH_AUTHELIA_ISSUER,
      providerId: 'authelia',
    }),
  checkEnvs: () => {
    return !!(
      authEnv.AUTH_AUTHELIA_ID &&
      authEnv.AUTH_AUTHELIA_SECRET &&
      authEnv.AUTH_AUTHELIA_ISSUER
    )
      ? {
          AUTH_AUTHELIA_ID: authEnv.AUTH_AUTHELIA_ID,
          AUTH_AUTHELIA_ISSUER: authEnv.AUTH_AUTHELIA_ISSUER,
          AUTH_AUTHELIA_SECRET: authEnv.AUTH_AUTHELIA_SECRET,
        }
      : false;
  },
  id: 'authelia',
  type: 'generic',
};

export default provider;
