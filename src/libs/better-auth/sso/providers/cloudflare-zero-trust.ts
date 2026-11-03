import { authEnv } from '@/envs/auth';

import { buildOidcConfig } from '../helpers';
import { type GenericProviderDefinition } from '../types';

const provider: GenericProviderDefinition<{
  AUTH_CLOUDFLARE_ZERO_TRUST_ID: string;
  AUTH_CLOUDFLARE_ZERO_TRUST_ISSUER: string;
  AUTH_CLOUDFLARE_ZERO_TRUST_SECRET: string;
}> = {
  build: (env) =>
    buildOidcConfig({
      clientId: env.AUTH_CLOUDFLARE_ZERO_TRUST_ID,
      clientSecret: env.AUTH_CLOUDFLARE_ZERO_TRUST_SECRET,
      issuer: env.AUTH_CLOUDFLARE_ZERO_TRUST_ISSUER,
      overrides: {
        mapProfileToUser: (profile) => ({
          email: profile.email,
          name: profile.name ?? profile.email ?? profile.sub,
        }),
      },
      providerId: 'cloudflare-zero-trust',
    }),
  checkEnvs: () => {
    return !!(
      authEnv.AUTH_CLOUDFLARE_ZERO_TRUST_ID &&
      authEnv.AUTH_CLOUDFLARE_ZERO_TRUST_SECRET &&
      authEnv.AUTH_CLOUDFLARE_ZERO_TRUST_ISSUER
    )
      ? {
          AUTH_CLOUDFLARE_ZERO_TRUST_ID: authEnv.AUTH_CLOUDFLARE_ZERO_TRUST_ID,
          AUTH_CLOUDFLARE_ZERO_TRUST_ISSUER: authEnv.AUTH_CLOUDFLARE_ZERO_TRUST_ISSUER,
          AUTH_CLOUDFLARE_ZERO_TRUST_SECRET: authEnv.AUTH_CLOUDFLARE_ZERO_TRUST_SECRET,
        }
      : false;
  },
  id: 'cloudflare-zero-trust',
  type: 'generic',
};

export default provider;
