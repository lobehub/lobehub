/**
 * Wire protocol of the local app handoff interface.
 *
 * A signed-in desktop app listens on a loopback port and lets another native
 * app on the same machine, signed by a publisher the server lists, obtain a
 * one-time authorization code for its *own* OIDC client. The native app
 * redeems the code at the token endpoint with its own PKCE verifier, so it ends
 * up with an independent grant and refresh token; nothing of the desktop app's
 * session leaves this process.
 */

export const APP_HANDOFF_PROTOCOL_VERSION = 1;

export const APP_HANDOFF_PATHS = {
  code: '/app-handoff/v1/code',
  status: '/app-handoff/v1/status',
} as const;

/** Deep link fallback: `<scheme>://app/handoff?...`, used to wake a desktop app that is not running. */
export const APP_HANDOFF_DEEP_LINK = { action: 'handoff', urlType: 'app' } as const;

/** Largest request body the interface reads. */
export const APP_HANDOFF_MAX_BODY_BYTES = 4096;

/** How long the user has to answer the confirmation dialog before it counts as a refusal. */
export const APP_HANDOFF_CONFIRM_TIMEOUT_MS = 60_000;

/** Local requests one desktop app accepts per minute, across all callers. */
export const APP_HANDOFF_LOCAL_RATE_LIMIT = 10;

export type AppHandoffChannel = 'beta' | 'dev' | 'nightly' | 'stable';

/** Written to `~/.lobehub/desktop-handoff/<channel>.json` while the interface is listening. */
export interface AppHandoffDiscovery {
  channel: AppHandoffChannel;
  issuer: string;
  pid: number;
  port: number;
  v: typeof APP_HANDOFF_PROTOCOL_VERSION;
}

/** Body of `POST /app-handoff/v1/code`. */
export interface AppHandoffCodeRequest {
  client_id: string;
  code_challenge: string;
  code_challenge_method?: 'S256';
  /** The issuer the native app is configured for. */
  issuer: string;
  /** The native app's loopback callback; the code is bound to it. */
  redirect_uri: string;
  resource?: string;
  scope?: string;
  /** Echoed back so the native app can match the response to its attempt. */
  state: string;
  /** When the native app already holds a session, its user; a different desktop user is refused. */
  sub?: string;
}

export interface AppHandoffCodeResponse {
  code: string;
  expires_in: number;
  iss: string;
  state: string;
}

export interface AppHandoffStatusResponse {
  issuer: string;
  signedIn: boolean;
  /** Only returned to a verified or previously allowed caller. */
  sub?: string;
}

export type AppHandoffErrorCode =
  | 'denied'
  | 'forbidden'
  | 'invalid_request'
  | 'issuer_mismatch'
  | 'method_not_allowed'
  | 'not_available'
  | 'not_found'
  | 'not_signed_in'
  | 'rate_limited'
  | 'server_error'
  | 'unauthorized_client'
  | 'user_mismatch';

const STATUS: Record<AppHandoffErrorCode, number> = {
  denied: 403,
  forbidden: 403,
  invalid_request: 400,
  issuer_mismatch: 409,
  method_not_allowed: 405,
  not_available: 404,
  not_found: 404,
  not_signed_in: 401,
  rate_limited: 429,
  server_error: 502,
  unauthorized_client: 403,
  user_mismatch: 409,
};

export class AppHandoffError extends Error {
  readonly status: number;

  constructor(
    readonly code: AppHandoffErrorCode,
    message: string = code,
    readonly extra: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'AppHandoffError';
    this.status = STATUS[code];
  }

  toJSON() {
    return { error: this.code, error_description: this.message, ...this.extra };
  }
}

export const isLoopbackRedirectUri = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) &&
      url.port !== '' &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

export const normalizeIssuer = (issuer: string) => issuer.replace(/\/+$/, '');

/** Validates a code request body; throws `invalid_request` naming the first bad field. */
export const parseCodeRequest = (body: unknown): AppHandoffCodeRequest => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppHandoffError('invalid_request', 'body must be a JSON object');
  }
  const input = body as Record<string, unknown>;
  const required = ['client_id', 'code_challenge', 'issuer', 'redirect_uri', 'state'] as const;
  for (const field of required) {
    if (typeof input[field] !== 'string' || !(input[field] as string)) {
      throw new AppHandoffError('invalid_request', `${field} is required`);
    }
  }
  for (const field of ['code_challenge_method', 'resource', 'scope', 'sub'] as const) {
    if (input[field] !== undefined && typeof input[field] !== 'string') {
      throw new AppHandoffError('invalid_request', `${field} must be a string`);
    }
  }
  if (input.code_challenge_method !== undefined && input.code_challenge_method !== 'S256') {
    throw new AppHandoffError('invalid_request', 'code_challenge_method must be S256');
  }
  if (!isLoopbackRedirectUri(input.redirect_uri)) {
    throw new AppHandoffError(
      'invalid_request',
      'redirect_uri must be an http loopback URI with a port',
    );
  }
  if ((input.state as string).length > 512) {
    throw new AppHandoffError('invalid_request', 'state is too long');
  }

  return input as unknown as AppHandoffCodeRequest;
};
