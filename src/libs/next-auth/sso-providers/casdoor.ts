import { type OIDCConfig, type OIDCUserConfig } from '@auth/core/providers';

import { CommonProviderConfig } from './sso.config';

interface CasdoorProfile extends Record<string, any> {
  avatar: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  id: string;
  lastName: string;
  name: string;
  owner: string;
  permanentAvatar: string;
}

function LobeCasdoorProvider(config: OIDCUserConfig<CasdoorProfile>): OIDCConfig<CasdoorProfile> {
  return {
    ...CommonProviderConfig,
    ...config,
    id: 'casdoor',
    name: 'Casdoor',
    profile(profile) {
      return {
        email: profile.email,
        emailVerified: profile.emailVerified ? new Date() : null,
        id: profile.id,
        image: profile.avatar,
        name: profile.displayName ?? profile.firstName ?? profile.lastName,
        providerAccountId: profile.id,
      };
    },
    type: 'oidc',
  };
}

const provider = {
  id: 'casdoor',
  provider: LobeCasdoorProvider({
    authorization: {
      params: { scope: 'openid profile email' },
    },
    clientId: process.env.AUTH_CASDOOR_ID,
    clientSecret: process.env.AUTH_CASDOOR_SECRET,
    issuer: process.env.AUTH_CASDOOR_ISSUER,
  }),
};

export default provider;
