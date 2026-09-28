import { CLI_PRIMARY_BIN } from '../constants/identity';
import { resolveServerUrl } from '../settings';
import { loadCredentials, saveCredentials, type StoredCredentials } from './credentials';

const CLIENT_ID = 'lobehub-cli';

/**
 * Why a refresh did not produce a token.
 *
 * Every failure used to be the same `null`, so a timeout or a 502 on the way to the token endpoint
 * was reported as "No authentication found. Run `lh login`" — sending the user to re-authenticate
 * over a network blip with a perfectly good refresh token still on disk. The three failure shapes
 * below each have a different remedy, and telling them apart is the whole point: only `spent`
 * means signing in again achieves anything.
 */
export type TokenLookup =
  | { credentials: StoredCredentials; status: 'ok' }
  /** Nothing on disk to work with: no credentials file, or no refresh token to spend. */
  | { status: 'no-login' }
  /** The server proved the stored refresh token is done. Signing in again is the fix. */
  | { detail: string; status: 'spent' }
  /**
   * The server said no for a reason the stored credential is not responsible for — a client
   * misconfiguration, a wrong server URL, a proxy or WAF in front of the endpoint. Neither
   * retrying nor signing in again changes the answer.
   */
  | { detail: string; status: 'refused' }
  /** No usable answer came back. The stored credentials are untouched, so retrying is the fix. */
  | { detail: string; status: 'unavailable' };

/** HTTP statuses that say "ask again later" rather than "this token is dead". */
const TRANSIENT_STATUSES = new Set([408, 425, 429]);

/**
 * The one OAuth error that proves the stored refresh token itself is finished (RFC 6749 §5.2).
 * Its neighbours — `invalid_client`, `invalid_request`, `unauthorized_client` — describe how the
 * request was built, not whether the credential still lives, so re-authenticating over them just
 * walks the user into the same wall.
 */
const CREDENTIAL_SPENT_ERROR = 'invalid_grant';

/**
 * Get a valid access token, refreshing if expired.
 */
export async function getValidToken(bufferSeconds = 60): Promise<TokenLookup> {
  const credentials = loadCredentials();
  if (!credentials) return { status: 'no-login' };

  // Check if token is still valid (with configurable buffer)
  if (credentials.expiresAt && Date.now() / 1000 < credentials.expiresAt - bufferSeconds) {
    return { credentials, status: 'ok' };
  }

  // Token expired — try refresh
  if (!credentials.refreshToken) return { status: 'no-login' };

  const serverUrl = resolveServerUrl();
  const refreshed = await refreshAccessToken(serverUrl, credentials.refreshToken);
  if (refreshed.status !== 'ok') return refreshed;

  const updated: StoredCredentials = {
    accessToken: refreshed.token.access_token,
    expiresAt: refreshed.token.expires_in
      ? Math.floor(Date.now() / 1000) + refreshed.token.expires_in
      : undefined,
    refreshToken: refreshed.token.refresh_token || credentials.refreshToken,
  };

  saveCredentials(updated);
  return { credentials: updated, status: 'ok' };
}

/**
 * What went wrong, and what the user can do about it.
 *
 * The two are separate fields because they render in different places: a command prints them as
 * one line, while `lh doctor` has its own `fix` slot and would otherwise repeat the remedy right
 * next to itself — or worse, print its own generic one contradicting the diagnosis above it.
 */
export interface TokenLookupReport {
  /** What the server said, in the user's terms. */
  detail: string;
  /** The action that actually changes the outcome. */
  fix: string;
}

/**
 * How to explain a lookup that produced no token, or `undefined` when there is nothing to
 * diagnose and the caller's own "log in first" message fits.
 */
export function describeTokenLookup(lookup: TokenLookup): TokenLookupReport | undefined {
  switch (lookup.status) {
    case 'spent': {
      return {
        detail: `The stored login is no longer valid (${lookup.detail}).`,
        fix: `Run '${CLI_PRIMARY_BIN} login' again.`,
      };
    }
    case 'refused': {
      return {
        detail: `The server refused the refresh request: ${lookup.detail}. The stored login is intact, so the credential is not what it is objecting to.`,
        fix: 'Check the server URL and anything sitting in front of it — signing in again will not change the answer.',
      };
    }
    case 'unavailable': {
      return {
        detail: `Could not reach the server to refresh the access token: ${lookup.detail}. The stored login is untouched, so this is the network or the server rather than a signed-out session.`,
        fix: 'Retry in a moment; the stored login does not need renewing.',
      };
    }
    default: {
      return undefined;
    }
  }
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type: string;
}

type RefreshResult =
  | { status: 'ok'; token: TokenResponse }
  | { detail: string; status: 'refused' }
  | { detail: string; status: 'spent' }
  | { detail: string; status: 'unavailable' };

async function refreshAccessToken(serverUrl: string, refreshToken: string): Promise<RefreshResult> {
  let res: Response;

  try {
    res = await fetch(`${serverUrl}/oidc/token`, {
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      status: 'unavailable',
    };
  }

  // A proxy or gateway in front of the token endpoint answers with HTML, not JSON.
  const body = (await res.json().catch(() => undefined)) as
    (TokenResponse & { error?: string; error_description?: string }) | undefined;

  if (!res.ok) {
    const detail = body?.error
      ? `${body.error}${body.error_description ? `: ${body.error_description}` : ''}`
      : `HTTP ${res.status}`;

    if (res.status >= 500 || TRANSIENT_STATUSES.has(res.status)) {
      return { detail, status: 'unavailable' };
    }

    // The status code alone cannot tell these apart: a 400 carrying `invalid_grant` is a spent
    // token, while a 400 carrying `invalid_request`, a 401 from client auth, a WAF's 403 or a
    // 404 from the wrong server URL all leave the stored credential untouched.
    return body?.error === CREDENTIAL_SPENT_ERROR
      ? { detail, status: 'spent' }
      : { detail, status: 'refused' };
  }

  if (body?.error) {
    return body.error === CREDENTIAL_SPENT_ERROR
      ? { detail: body.error, status: 'spent' }
      : { detail: body.error, status: 'refused' };
  }

  // A 2xx with nothing usable in it is the server misbehaving, so it may well answer next time.
  if (!body?.access_token) {
    return { detail: 'the response carried no access token', status: 'unavailable' };
  }

  return { status: 'ok', token: body };
}
