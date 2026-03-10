import { authEnv } from '@/envs/auth';

import { buildOidcConfig } from '../helpers';
import { type GenericProviderDefinition } from '../types';

type ZitadelEnv = {
  AUTH_ZITADEL_ID?: string;
  AUTH_ZITADEL_ISSUER?: string;
  AUTH_ZITADEL_SECRET?: string;
};

const provider: GenericProviderDefinition<ZitadelEnv> = {
  build: (env) =>
    buildOidcConfig({
      clientId: env.AUTH_ZITADEL_ID!,
      clientSecret: env.AUTH_ZITADEL_SECRET!,
      issuer: env.AUTH_ZITADEL_ISSUER!,
      providerId: 'zitadel',
    }),
  checkEnvs: () => {
    const clientId = authEnv.AUTH_ZITADEL_ID;
    const clientSecret = authEnv.AUTH_ZITADEL_SECRET;
    const issuer = authEnv.AUTH_ZITADEL_ISSUER;
    return !!(clientId && clientSecret && issuer)
      ? {
          AUTH_ZITADEL_ID: clientId,
          AUTH_ZITADEL_ISSUER: issuer,
          AUTH_ZITADEL_SECRET: clientSecret,
        }
      : false;
  },
  id: 'zitadel',
  type: 'generic',
};

export default provider;
