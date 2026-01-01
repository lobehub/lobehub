import { Apple, Aws, Google, Microsoft } from '@lobehub/icons';
import {
  Auth0,
  Authelia,
  Authentik,
  Casdoor,
  Cloudflare,
  Github,
  Logto,
  MicrosoftEntra,
  NextAuth,
  Zitadel,
} from '@lobehub/ui/icons';
import React from 'react';

// TODO: check this
const iconComponents: { [key: string]: any } = {
  'apple': Apple,
  'auth0': Auth0,
  'authelia': Authelia.Color,
  'authentik': Authentik.Color,
  'casdoor': Casdoor.Color,
  'cloudflare': Cloudflare.Color,
  'cognito': Aws.Color,
  'default': NextAuth.Color,
  'github': Github,
  'google': Google.Color,
  'logto': Logto.Color,
  'microsoft': Microsoft.Color,
  'microsoft-entra-id': MicrosoftEntra.Color,
  'zitadel': Zitadel.Color,
};

/**
 * Get the auth icons component for the given id
 * @param id
 * @param size default is 36
 * @returns
 */
const AuthIcons = (id: string, size = 36) => {
  const IconComponent = iconComponents[id] || iconComponents.default;
  return <IconComponent size={size} />;
};

export default AuthIcons;
