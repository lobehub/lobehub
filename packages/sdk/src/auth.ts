import { DEFAULT_BASE_URL } from './constants';

/** The audience every `/api/v1` access token is issued for. */
export const LOBEHUB_API_RESOURCE = 'urn:lobehub:chat';

/** Scopes a native app needs to call `/api/v1` and keep a refresh token. */
export const DEFAULT_OAUTH_SCOPE = 'profile email offline_access';

export interface OAuthClientOptions {
  /** Origin of the LobeHub deployment, defaults to LobeHub Cloud */
  baseURL?: string;
  /** A registered public client, e.g. `lobehub-mobile` */
  clientId: string;
  fetch?: typeof globalThis.fetch;
}

export interface OAuthTokens {
  accessToken: string;
  /** Epoch milliseconds */
  expiresAt: number;
  /** Rotated on every refresh: always persist the latest one */
  refreshToken?: string;
  scope?: string;
  tokenType: string;
}

export interface PkcePair {
  challenge: string;
  verifier: string;
}

export class LobeHubOAuthError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message?: string, status?: number) {
    super(message ?? code);
    this.name = 'LobeHubOAuthError';
    this.code = code;
    this.status = status;
  }
}

// Hand-rolled instead of URLSearchParams so the module also runs in hosts without it (JavaScriptCore).
const encodeForm = (params: Record<string, string | undefined>) =>
  Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

const oidcUrl = (baseURL: string | undefined, path: string) =>
  `${(baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/oidc/${path}`;

const queryParam = (url: string, name: string) => {
  const match = url.match(new RegExp(`[?&#]${name}=([^&#]*)`));
  return match ? decodeURIComponent(match[1].replaceAll('+', ' ')) : undefined;
};

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

/**
 * Generate a PKCE verifier and its S256 challenge with Web Crypto.
 * Hosts without `crypto.subtle` (JavaScriptCore, older RN) should create the
 * pair natively and pass it to {@link createAuthorizationUrl} instead.
 */
export const createPkcePair = async (): Promise<PkcePair> => {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle)
    throw new LobeHubOAuthError('pkce_unavailable', 'crypto.subtle is not available');

  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { challenge: base64Url(new Uint8Array(digest)), verifier };
};

/** Build the `/oidc/auth` URL to open in the system browser session. */
export const createAuthorizationUrl = (
  options: Omit<OAuthClientOptions, 'fetch'> & {
    codeChallenge: string;
    redirectUri: string;
    scope?: string;
    state: string;
  },
): string =>
  `${oidcUrl(options.baseURL, 'auth')}?${encodeForm({
    client_id: options.clientId,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    // oidc-provider only issues a refresh token for offline_access after an explicit consent prompt.
    prompt: 'consent',
    redirect_uri: options.redirectUri,
    resource: LOBEHUB_API_RESOURCE,
    response_type: 'code',
    scope: options.scope ?? DEFAULT_OAUTH_SCOPE,
    state: options.state,
  })}`;

/**
 * Read the authorization code from the callback URL, rejecting a state that
 * does not match the one sent with {@link createAuthorizationUrl}.
 */
export const parseAuthorizationCallback = (callbackUrl: string, expectedState: string): string => {
  const error = queryParam(callbackUrl, 'error');
  if (error) throw new LobeHubOAuthError(error, queryParam(callbackUrl, 'error_description'));
  if (queryParam(callbackUrl, 'state') !== expectedState)
    throw new LobeHubOAuthError('state_mismatch');

  const code = queryParam(callbackUrl, 'code');
  if (!code) throw new LobeHubOAuthError('missing_code');
  return code;
};

const requestTokens = async (
  options: OAuthClientOptions,
  params: Record<string, string>,
): Promise<OAuthTokens> => {
  const fetch = options.fetch ?? globalThis.fetch;
  const requestedAt = Date.now();
  const response = await fetch(oidcUrl(options.baseURL, 'token'), {
    body: encodeForm({ client_id: options.clientId, ...params }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new LobeHubOAuthError(
      typeof body.error === 'string' ? body.error : `http_${response.status}`,
      typeof body.error_description === 'string' ? body.error_description : undefined,
      response.status,
    );
  }
  if (typeof body.access_token !== 'string') throw new LobeHubOAuthError('missing_access_token');

  return {
    accessToken: body.access_token,
    expiresAt: requestedAt + Number(body.expires_in ?? 0) * 1000,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
    tokenType: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
  };
};

/** Exchange the authorization code for tokens (`authorization_code` grant). */
export const exchangeAuthorizationCode = (
  options: OAuthClientOptions & { code: string; codeVerifier: string; redirectUri: string },
): Promise<OAuthTokens> =>
  requestTokens(options, {
    code: options.code,
    code_verifier: options.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: options.redirectUri,
  });

/**
 * Trade a refresh token for a new access token. The refresh token rotates:
 * replace the stored one with `refreshToken` from the result. `invalid_grant`
 * means the grant is gone and the user has to sign in again.
 */
export const refreshAccessToken = (
  options: OAuthClientOptions & { refreshToken: string },
): Promise<OAuthTokens> =>
  requestTokens(options, { grant_type: 'refresh_token', refresh_token: options.refreshToken });
