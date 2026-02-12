import { authEnv } from '@/envs/auth';

import { buildOidcConfig } from '../helpers';
import { type GenericProviderDefinition } from '../types';

const provider: GenericProviderDefinition<{
  AUTH_KEYCLOAK_ID: string;
  AUTH_KEYCLOAK_ISSUER: string;
  AUTH_KEYCLOAK_SECRET: string;
}> = {
  build: (env) =>
    buildOidcConfig({
      clientId: env.AUTH_KEYCLOAK_ID,
      clientSecret: env.AUTH_KEYCLOAK_SECRET,
      issuer: env.AUTH_KEYCLOAK_ISSUER,
      providerId: 'keycloak',
    }),
  checkEnvs: () => {
    return !!(
      authEnv.AUTH_KEYCLOAK_ID &&
      authEnv.AUTH_KEYCLOAK_SECRET &&
      authEnv.AUTH_KEYCLOAK_ISSUER
    )
      ? {
          AUTH_KEYCLOAK_ID: authEnv.AUTH_KEYCLOAK_ID,
          AUTH_KEYCLOAK_ISSUER: authEnv.AUTH_KEYCLOAK_ISSUER,
          AUTH_KEYCLOAK_SECRET: authEnv.AUTH_KEYCLOAK_SECRET,
        }
      : false;
  },
  id: 'keycloak',
  type: 'generic',
};

export default provider;
