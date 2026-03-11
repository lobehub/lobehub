import { authEnv } from '@/envs/auth';

import { buildOidcConfig } from '../helpers';
import { type GenericProviderDefinition } from '../types';

const provider: GenericProviderDefinition<{
  AUTH_AUTHENTIK_ID: string;
  AUTH_AUTHENTIK_ISSUER: string;
  AUTH_AUTHENTIK_SECRET: string;
}> = {
  build: (env) =>
    buildOidcConfig({
      clientId: env.AUTH_AUTHENTIK_ID,
      clientSecret: env.AUTH_AUTHENTIK_SECRET,
      issuer: env.AUTH_AUTHENTIK_ISSUER,
      providerId: 'authentik',
    }),
  checkEnvs: () => {
    return !!(
      authEnv.AUTH_AUTHENTIK_ID &&
      authEnv.AUTH_AUTHENTIK_SECRET &&
      authEnv.AUTH_AUTHENTIK_ISSUER
    )
      ? {
          AUTH_AUTHENTIK_ID: authEnv.AUTH_AUTHENTIK_ID,
          AUTH_AUTHENTIK_ISSUER: authEnv.AUTH_AUTHENTIK_ISSUER,
          AUTH_AUTHENTIK_SECRET: authEnv.AUTH_AUTHENTIK_SECRET,
        }
      : false;
  },
  id: 'authentik',
  type: 'generic',
};

export default provider;
