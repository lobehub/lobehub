import { authEnv } from '@/envs/auth';

import { buildOidcConfig } from '../helpers';
import { type GenericProviderDefinition } from '../types';

const provider: GenericProviderDefinition<{
  AUTH_AUTH0_ID: string;
  AUTH_AUTH0_ISSUER: string;
  AUTH_AUTH0_SECRET: string;
}> = {
  build: (env) => {
    const config = buildOidcConfig({
      clientId: env.AUTH_AUTH0_ID,
      clientSecret: env.AUTH_AUTH0_SECRET,
      issuer: env.AUTH_AUTH0_ISSUER,
      providerId: 'auth0',
    });
    return config;
  },
  checkEnvs: () => {
    return !!(authEnv.AUTH_AUTH0_ID && authEnv.AUTH_AUTH0_SECRET && authEnv.AUTH_AUTH0_ISSUER)
      ? {
          AUTH_AUTH0_ID: authEnv.AUTH_AUTH0_ID,
          AUTH_AUTH0_ISSUER: authEnv.AUTH_AUTH0_ISSUER,
          AUTH_AUTH0_SECRET: authEnv.AUTH_AUTH0_SECRET,
        }
      : false;
  },
  id: 'auth0',
  type: 'generic',
};

export default provider;
