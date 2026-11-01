import {
  ACCEPTANCE_REVIEW_CLIENT_ID,
  ACCEPTANCE_REVIEW_SCOPE,
  ACCEPTANCE_REVIEW_TOKEN_TTL_SECONDS,
  acceptanceIdFromReviewResource,
  isReviewResource,
  siteReviewFromResource,
} from '@lobechat/const';

export const isAcceptanceReviewClient = (clientId: string | undefined) =>
  clientId === ACCEPTANCE_REVIEW_CLIENT_ID;

// The review toolbar's token lives on third-party preview pages, so it must
// only ever carry one acceptance's audience — never the full API audience.
const DEVICE_ROUTES = new Set(['code_verification', 'device_authorization', 'device_resume']);
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export interface ReviewFlow {
  grantType?: string;
  route?: string;
}

const isDeviceFlow = (flow: ReviewFlow) =>
  DEVICE_ROUTES.has(flow.route ?? '') || flow.grantType === DEVICE_GRANT;

export const reviewResourceServer = (
  clientId: string | undefined,
  indicator: string,
  requested?: unknown,
  flow: ReviewFlow = {},
) => {
  if (!isAcceptanceReviewClient(clientId)) return null;
  const site = siteReviewFromResource(indicator);
  if (!site && !acceptanceIdFromReviewResource(indicator)) return 'reject' as const;
  // A site token is handed back to the page by postMessage to its registered
  // origin; the device flow has no page to hand it to, so it would deliver a
  // site token to whoever started the flow.
  if (site && isDeviceFlow(flow)) return 'reject' as const;
  // Consent names and access-checks a single acceptance, so a request for
  // several would grant the ones the reviewer never saw.
  if (Array.isArray(requested) && requested.length > 1) return 'reject' as const;
  return {
    accessTokenFormat: 'jwt' as const,
    accessTokenTTL: ACCEPTANCE_REVIEW_TOKEN_TTL_SECONDS,
    audience: indicator,
    scope: ACCEPTANCE_REVIEW_SCOPE,
  };
};

// A numeric `ttl.AccessToken` overrides every resource server's own lifetime.
export const accessTokenTTL = (
  token: { resourceServer?: { accessTokenTTL?: number } },
  fallback: number,
) => token.resourceServer?.accessTokenTTL ?? fallback;

export const isAcceptanceReviewAudience = (aud: unknown) => isReviewResource(aud);

// The review client is public and reachable from any origin, so nothing it was
// issued — access token or ID token — may ever pass as an app session.
export const isAcceptanceReviewIssued = (payload: { aud?: unknown; client_id?: unknown }) =>
  isAcceptanceReviewAudience(payload.aud) ||
  isAcceptanceReviewClient(payload.client_id as string | undefined) ||
  (Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(ACCEPTANCE_REVIEW_CLIENT_ID);
