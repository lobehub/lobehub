import { createHmac, timingSafeEqual } from 'node:crypto';

import { SLACK_API_BASE } from '@/server/services/bot/platforms/slack/api';

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_OAUTH_ACCESS_URL = `${SLACK_API_BASE}/oauth.v2.access`;
const SLACK_AUTH_REVOKE_URL = `${SLACK_API_BASE}/auth.revoke`;
const SLACK_SIGNATURE_VERSION = 'v0';
const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface BuildInstallUrlParams {
  clientId: string;
  redirectUri: string;
  /** Bot scopes — populates the `xoxb-` token. */
  scopes: string[];
  /** Opaque server-generated token; the caller persists the lookup row. */
  state: string;
  /** Optional user scopes — populates a separate `xoxp-` token. Empty by default. */
  userScopes?: string[];
}

/**
 * Build the Slack workspace-install authorize URL. The `state` parameter is
 * passed through verbatim — the caller is responsible for binding it to a
 * server-side record (LobeHub user id, nonce, ttl) so the callback handler
 * can validate the request didn't come from elsewhere.
 */
export const buildInstallUrl = (params: BuildInstallUrlParams): string => {
  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('scope', params.scopes.join(','));
  if (params.userScopes && params.userScopes.length > 0) {
    url.searchParams.set('user_scope', params.userScopes.join(','));
  }
  return url.toString();
};

/**
 * Slack `oauth.v2.access` response — fields are a superset of what we need
 * today; PR2's installation store narrows the parts it cares about.
 *
 * `is_enterprise_install: true` means an org-level install — `team` may be
 * null and the install must be keyed by `enterprise.id` instead. `expires_in`
 * + `refresh_token` are present only when token rotation is enabled on the
 * App config.
 */
export interface OAuthV2AccessResponse {
  access_token?: string;
  app_id?: string;
  authed_user?: { access_token?: string; id: string; scope?: string; token_type?: string };
  bot_user_id?: string;
  enterprise?: { id: string; name: string } | null;
  error?: string;
  expires_in?: number;
  is_enterprise_install?: boolean;
  ok: boolean;
  refresh_token?: string;
  scope?: string;
  team?: { id: string; name: string } | null;
  token_type?: 'bot';
}

export interface ExchangeCodeParams {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

/**
 * Exchange the OAuth `code` returned by Slack's authorize redirect for a bot
 * token. Slack accepts client credentials either as Basic auth header or as
 * form fields; we use form fields because they're simpler to mock and the
 * Slack docs use them in their canonical examples.
 */
export const exchangeCode = async (params: ExchangeCodeParams): Promise<OAuthV2AccessResponse> => {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });

  const response = await fetch(SLACK_OAUTH_ACCESS_URL, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`oauth.v2.access HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as OAuthV2AccessResponse;
  if (!data.ok) {
    throw new Error(`oauth.v2.access failed: ${data.error ?? 'unknown_error'}`);
  }
  return data;
};

/**
 * Invalidate a Slack token via `auth.revoke`. Used when we reject a freshly
 * minted token (e.g. another LobeHub user already owns this workspace's
 * install) so the workspace doesn't end up with a dangling unused bot token.
 */
export const revokeToken = async (token: string): Promise<void> => {
  const body = new URLSearchParams({ token });
  const response = await fetch(SLACK_AUTH_REVOKE_URL, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`auth.revoke HTTP ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as { error?: string; ok: boolean };
  if (!data.ok) {
    throw new Error(`auth.revoke failed: ${data.error ?? 'unknown_error'}`);
  }
};

export interface RefreshTokenParams {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * Refresh a rotating bot token. Slack returns a new access token AND a new
 * refresh token in the same response — the old refresh token is invalidated
 * the moment the new one is issued, so callers MUST persist both atomically
 * (see `MessengerInstallationModel.updateRotatedToken`).
 */
export const refreshToken = async (params: RefreshTokenParams): Promise<OAuthV2AccessResponse> => {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  });

  const response = await fetch(SLACK_OAUTH_ACCESS_URL, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`oauth.v2.access (refresh) HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as OAuthV2AccessResponse;
  if (!data.ok) {
    throw new Error(`oauth.v2.access (refresh) failed: ${data.error ?? 'unknown_error'}`);
  }
  return data;
};

export interface VerifySignatureParams {
  /** Raw request body — must be the bytes Slack signed, before any JSON / form parsing. */
  rawBody: string;
  signature: string;
  signingSecret: string;
  timestamp: string;
  /** Window in seconds — requests outside it are rejected as replays. Default 300 (5 min). */
  toleranceSeconds?: number;
}

/**
 * Verify a Slack inbound webhook signature.
 *
 *   basestring = "v0:" + X-Slack-Request-Timestamp + ":" + raw_body
 *   sig        = "v0=" + hex(hmac_sha256(signing_secret, basestring))
 *
 * Reject if the timestamp is outside the tolerance window — Slack's docs
 * explicitly call out replay protection as the reason this check exists.
 *
 * Same HMAC pattern as `bot/platforms/slack/gateway.ts:303`, factored out so
 * the messenger router can verify without coupling to socket-mode wiring.
 */
export const verifySignature = (params: VerifySignatureParams): boolean => {
  const tolerance = params.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  const ts = Number(params.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > tolerance) return false;

  const baseString = `${SLACK_SIGNATURE_VERSION}:${params.timestamp}:${params.rawBody}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac('sha256', params.signingSecret)
    .update(baseString)
    .digest('hex')}`;

  // Hex strings — must be the same length before timingSafeEqual or it throws.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(params.signature, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
};
