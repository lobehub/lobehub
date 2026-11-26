import { isTrimmedNonEmptyString } from '@lobechat/utils/object';
import { type GenericOAuthConfig } from 'better-auth/plugins';

export const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile'];

/** Custom OIDC claims are untrusted unknown values, not necessarily strings. */
export const getStringClaim = (...values: unknown[]): string | undefined =>
  values.find(isTrimmedNonEmptyString);

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
  scopes = DEFAULT_OIDC_SCOPES,
  pkce = true,
  overrides,
}: OIDCProviderInput): GenericOAuthConfig => {
  const sanitizedIssuer = issuer?.trim();

  if (!clientId || !clientSecret || !sanitizedIssuer) {
    throw new Error(`[Better-Auth] ${providerId} OAuth enabled but missing credentials`);
  }

  const normalizedIssuer = sanitizedIssuer.replace(/\/$/, '');
  const discoveryUrl = createDiscoveryUrl(normalizedIssuer);

  return {
    /**
     * Better Auth 1.6 identified generic providers by `id`, then `sub`. Keep that order so the
     * 1.7 migration neither changes existing account IDs nor rejects OIDC UserInfo responses that
     * expose only the standard `sub` claim when discovery metadata is incomplete.
     */
    accountSubject: ({ profile }) =>
      profile.id === undefined || profile.id === null || profile.id === ''
        ? (profile.sub ?? '')
        : profile.id,
    clientId,
    clientSecret,
    discoveryUrl,
    pkce,
    providerId,
    scopes,
    ...overrides,
  } satisfies GenericOAuthConfig;
};
