import { authEnv } from '@/envs/auth';

import { buildOidcConfig } from '../helpers';
import { type GenericProviderDefinition } from '../types';

const provider: GenericProviderDefinition<{
  AUTH_CASDOOR_ID: string;
  AUTH_CASDOOR_ISSUER: string;
  AUTH_CASDOOR_SECRET: string;
}> = {
  build: (env) =>
    buildOidcConfig({
      clientId: env.AUTH_CASDOOR_ID,
      clientSecret: env.AUTH_CASDOOR_SECRET,
      issuer: env.AUTH_CASDOOR_ISSUER,
      overrides: {
        mapProfileToUser: (profile) => {
          const composedName = [profile.firstName, profile.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();
          const fallbackName = composedName.length > 0 ? composedName : undefined;

          return {
            email: profile.email,
            emailVerified: Boolean(profile.emailVerified),
            image: profile.avatar ?? profile.permanentAvatar,
            name:
              profile.displayName ?? fallbackName ?? profile.name ?? profile.email ?? profile.id,
          };
        },
      },
      providerId: 'casdoor',
    }),
  checkEnvs: () => {
    return !!(authEnv.AUTH_CASDOOR_ID && authEnv.AUTH_CASDOOR_SECRET && authEnv.AUTH_CASDOOR_ISSUER)
      ? {
          AUTH_CASDOOR_ID: authEnv.AUTH_CASDOOR_ID,
          AUTH_CASDOOR_ISSUER: authEnv.AUTH_CASDOOR_ISSUER,
          AUTH_CASDOOR_SECRET: authEnv.AUTH_CASDOOR_SECRET,
        }
      : false;
  },
  id: 'casdoor',
  type: 'generic',
};

export default provider;
