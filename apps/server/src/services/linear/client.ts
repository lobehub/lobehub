import type { LinearConnectionCredentials } from '@lobechat/types';
import debug from 'debug';

import { appEnv } from '@/envs/app';
import { linearEnv } from '@/envs/linear';

const log = debug('lobe-server:linear:client');

const AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
const TOKEN_URL = 'https://api.linear.app/oauth/token';
const REVOKE_URL = 'https://api.linear.app/oauth/revoke';
const GRAPHQL_URL = 'https://api.linear.app/graphql';

/** Read-only: connecting only needs to identify the workspace and its user. */
const SCOPES = ['read'];

export const LINEAR_INSTALL_PATH = '/api/webhooks/linear/install';
export const LINEAR_CALLBACK_PATH = '/api/webhooks/linear/oauth/callback';

/**
 * The callback URL registered on the Linear OAuth application. Built from
 * `APP_URL` rather than the request origin so the authorize and token legs
 * send byte-identical values behind any proxy.
 */
export const getLinearRedirectUri = (): string => {
  const base = appEnv.APP_URL;
  if (!base) throw new Error('APP_URL is not configured; cannot build the Linear redirect URI');
  return new URL(LINEAR_CALLBACK_PATH, base).toString();
};

export const buildLinearAuthorizeUrl = (state: string): string | undefined => {
  if (!linearEnv.ENABLED_LINEAR || !linearEnv.LINEAR_CLIENT_ID) return undefined;

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', linearEnv.LINEAR_CLIENT_ID);
  url.searchParams.set('redirect_uri', getLinearRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('state', state);
  // Always show the workspace picker, so a user in several Linear workspaces
  // can choose which one to connect instead of silently reusing the last.
  url.searchParams.set('prompt', 'consent');
  return url.toString();
};

export interface LinearTokenSet {
  accessToken: string;
  /** Absent for tokens Linear issues without expiry. */
  expiresAt?: Date;
  refreshToken?: string;
  scopes: string[];
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string | string[];
}

const requestToken = async (body: Record<string, string>): Promise<LinearTokenSet> => {
  if (!linearEnv.LINEAR_CLIENT_ID || !linearEnv.LINEAR_CLIENT_SECRET) {
    throw new Error('Linear OAuth application is not configured');
  }

  const response = await fetch(TOKEN_URL, {
    body: new URLSearchParams({
      client_id: linearEnv.LINEAR_CLIENT_ID,
      client_secret: linearEnv.LINEAR_CLIENT_SECRET,
      ...body,
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Linear token request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as TokenResponse;
  const scopes = Array.isArray(data.scope) ? data.scope : (data.scope?.split(/[ ,]/) ?? []);
  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    refreshToken: data.refresh_token,
    scopes: scopes.filter(Boolean),
  };
};

export const exchangeLinearCode = (code: string): Promise<LinearTokenSet> =>
  requestToken({
    code,
    grant_type: 'authorization_code',
    redirect_uri: getLinearRedirectUri(),
  });

export const refreshLinearToken = (refreshToken: string): Promise<LinearTokenSet> =>
  requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken });

/**
 * Best effort: a token Linear already forgot is as good as revoked. An expired
 * access token cannot authorize its own revocation, so it is refreshed first.
 * Resolves whether Linear confirmed the revocation.
 */
export const revokeLinearToken = async (
  credentials: LinearConnectionCredentials,
  expiresAt?: Date | null,
): Promise<boolean> => {
  try {
    let { accessToken } = credentials;
    if (credentials.refreshToken && expiresAt && expiresAt.getTime() <= Date.now()) {
      const refreshed = await refreshLinearToken(credentials.refreshToken);
      accessToken = refreshed.accessToken;
    }

    const response = await fetch(REVOKE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      method: 'POST',
    });
    if (!response.ok) log('revoke rejected: %d %s', response.status, await response.text());
    return response.ok;
  } catch (error) {
    log('revoke failed: %O', error);
    return false;
  }
};

export class LinearApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LinearApiError';
  }
}

export const linearGraphql = async <T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(GRAPHQL_URL, {
    body: JSON.stringify({ query, variables }),
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    method: 'POST',
  });

  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (!response.ok || payload.errors?.length || !payload.data) {
    const message = payload.errors?.map((error) => error.message).join('; ') || response.statusText;
    throw new LinearApiError(`Linear API error: ${message}`, response.status);
  }
  return payload.data;
};

export interface LinearViewer {
  avatarUrl?: string;
  id: string;
  name: string;
  organization: { id: string; logoUrl?: string; name: string; urlKey: string };
}

export const fetchLinearViewer = async (accessToken: string): Promise<LinearViewer> => {
  const data = await linearGraphql<{ viewer: LinearViewer }>(
    accessToken,
    `query Viewer { viewer { id name avatarUrl organization { id name urlKey logoUrl } } }`,
  );
  return data.viewer;
};
