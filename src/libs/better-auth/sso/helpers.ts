import type { GenericOAuthConfig } from 'better-auth/plugins';

export const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile'];

const createDiscoveryUrl = (issuer: string) => {
  const normalized = issuer.replace(/\/$/, '');
  return normalized.includes('/.well-known/')
    ? normalized
    : `${normalized}/.well-known/openid-configuration`;
};

type OIDCProviderInput = {
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
  label?: string;
  overrides?: Partial<GenericOAuthConfig>;
  pkce?: boolean;
  providerId: string;
  scopes?: string[];
};

export const buildOidcConfig = ({
  providerId,
  clientId,
  clientSecret,
  issuer,
  label,
  scopes = DEFAULT_OIDC_SCOPES,
  pkce = true,
  overrides,
}: OIDCProviderInput): GenericOAuthConfig & { label?: string } => {
  const sanitizedIssuer = issuer?.trim();

  if (!clientId || !clientSecret || !sanitizedIssuer) {
    throw new Error(`[Better-Auth] ${providerId} OAuth enabled but missing credentials`);
  }

  const normalizedIssuer = sanitizedIssuer.replace(/\/$/, '');
  const discoveryUrl = createDiscoveryUrl(normalizedIssuer);

  return {
    clientId,
    clientSecret,
    discoveryUrl,
    label,
    pkce,
    providerId,
    scopes,
    ...overrides,
  } satisfies GenericOAuthConfig & { label?: string };
};
