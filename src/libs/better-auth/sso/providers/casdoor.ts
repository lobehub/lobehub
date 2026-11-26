import { authEnv } from '@/envs/auth';

import { buildOidcConfig, getStringClaim } from '../helpers';
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
          const composedName = [getStringClaim(profile.firstName), getStringClaim(profile.lastName)]
            .filter(Boolean)
            .join(' ')
            .trim();
          const fallbackName = composedName.length > 0 ? composedName : undefined;

          return {
            email: profile.email ?? undefined,
            emailVerified: Boolean(profile.emailVerified),
            image: getStringClaim(profile.avatar, profile.permanentAvatar),
            name: getStringClaim(
              profile.displayName,
              fallbackName,
              profile.name,
              profile.email,
              profile.id?.toString(),
            ),
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
