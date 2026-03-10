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
  Zitadel,
} from '@lobehub/ui/icons';
import { User } from 'lucide-react';

const iconComponents: { [key: string]: any } = {
  'apple': Apple,
  'auth0': Auth0,
  'authelia': Authelia.Color,
  'authentik': Authentik.Color,
  'casdoor': Casdoor.Color,
  'cloudflare': Cloudflare.Color,
  'cognito': Aws.Color,
  'github': Github,
  'google': Google.Color,
  'logto': Logto.Color,
  'microsoft': Microsoft.Color,
  'microsoft-entra-id': MicrosoftEntra.Color,
  'zitadel': Zitadel.Color,
};

/**
 * Get the auth icons component for the given provider id
 */
const AuthIcons = (id: string, size = 36) => {
  const IconComponent = iconComponents[id];
  if (IconComponent) {
    return <IconComponent size={size} />;
  }
  // Fallback to generic user icon for unknown providers
  return <User size={size} />;
};

export default AuthIcons;
