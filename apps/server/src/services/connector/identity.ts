import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { isRecord } from '@lobechat/utils/object';
import type { AuthorizationServerMetadata, OAuthTokens } from '@modelcontextprotocol/client';

import type { ConnectorLinkIdentity } from '@/database/models/connectorLink';

const identityFromClaims = (
  claims: unknown,
  issuer?: string,
): ConnectorLinkIdentity | undefined => {
  if (!isRecord(claims)) return;
  const string = (key: string) =>
    typeof claims[key] === 'string' ? (claims[key] as string) : undefined;
  const subject = string('sub');
  if (!subject) return;
  return {
    externalAccountId: JSON.stringify([issuer ?? string('iss') ?? '', subject]),
    profile: {
      avatar: string('picture'),
      email: string('email'),
      name: string('name'),
      username: string('preferred_username'),
    },
  };
};

/** Identity is best-effort display/deduplication data, never an authorization claim. */
export const resolveLinkIdentity = async ({
  tokens,
  metadata,
}: {
  tokens: OAuthTokens;
  metadata: AuthorizationServerMetadata;
}): Promise<ConnectorLinkIdentity | undefined> => {
  if (typeof tokens.id_token === 'string') {
    try {
      const identity = identityFromClaims(
        JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString()),
        metadata.issuer,
      );
      if (identity) return identity;
    } catch {
      /* A malformed ID token must not break successful OAuth. */
    }
  }
  const endpoint = metadata.userinfo_endpoint;
  if (typeof endpoint !== 'string') return;
  try {
    const response = await ssrfSafeFetch(endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    return identityFromClaims(await response.json(), metadata.issuer);
  } catch {
    /* Identity discovery is optional and must never fail authorization. */
  }
};
