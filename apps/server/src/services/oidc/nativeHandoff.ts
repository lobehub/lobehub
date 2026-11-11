import type { NativeHandoffPolicy, NativeHandoffTarget } from '@lobechat/business-const';
import { OIDC_NATIVE_HANDOFF } from '@lobechat/business-const';
import debug from 'debug';

import { isOIDCUserBanned } from '@/libs/oidc-provider/access-control';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';
import { API_AUDIENCE, type OIDCProvider } from '@/libs/oidc-provider/provider';

const log = debug('lobe-oidc:native-handoff');

/**
 * A handoff code has no human step between issue and exchange: the requesting
 * app reads it from the desktop app's response and exchanges it immediately.
 * A minute covers a slow network round trip; the standard 10-minute code TTL
 * exists for people reading a consent page, which nobody does here.
 */
export const NATIVE_HANDOFF_CODE_TTL_SECONDS = 60;

/** Requests one user may make per window, across all their desktop installs. */
export const NATIVE_HANDOFF_RATE_LIMIT = 5;
export const NATIVE_HANDOFF_RATE_WINDOW_SECONDS = 60;

/** Scopes a handoff may carry. Narrower than the provider's list on purpose. */
const HANDOFF_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access']);
const DEFAULT_SCOPE = 'openid profile email offline_access';

/** RFC 7636 §4.1: 43–128 characters of the unreserved set, here the S256 base64url output. */
const CODE_CHALLENGE_PATTERN = /^[\w-]{43,128}$/;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export type NativeHandoffErrorCode =
  | 'access_denied'
  | 'invalid_redirect_uri'
  | 'invalid_request'
  | 'invalid_scope'
  | 'invalid_target'
  | 'invalid_token'
  | 'issuer_mismatch'
  | 'not_available'
  | 'rate_limited'
  | 'unauthorized_client'
  | 'user_mismatch';

const STATUS: Record<NativeHandoffErrorCode, number> = {
  access_denied: 403,
  invalid_redirect_uri: 400,
  invalid_request: 400,
  invalid_scope: 400,
  invalid_target: 400,
  invalid_token: 401,
  issuer_mismatch: 409,
  not_available: 404,
  rate_limited: 429,
  unauthorized_client: 403,
  user_mismatch: 409,
};

export class NativeHandoffError extends Error {
  readonly status: number;

  constructor(
    readonly code: NativeHandoffErrorCode,
    readonly description: string,
  ) {
    super(description);
    this.name = 'NativeHandoffError';
    this.status = STATUS[code];
  }

  toJSON() {
    return { error: this.code, error_description: this.description };
  }
}

export interface NativeHandoffRequest {
  client_id?: unknown;
  code_challenge?: unknown;
  code_challenge_method?: unknown;
  /** The issuer the requesting app is configured for; must equal this provider's. */
  issuer?: unknown;
  redirect_uri?: unknown;
  resource?: unknown;
  scope?: unknown;
  /** When the requesting app already has a session, the user it belongs to. */
  sub?: unknown;
}

export interface NativeHandoffIssued {
  code: string;
  expires_in: number;
  iss: string;
}

export interface NativeHandoffAuditContext {
  ip?: string | null;
  userAgent?: string | null;
}

interface HandoffUser {
  banExpires: Date | null;
  banned: boolean | null;
}

export interface NativeHandoffDeps {
  /** Counts one request for the user; `undefined` when no shared counter is available. */
  countRequest?: (userId: string) => Promise<number | undefined>;
  findUser: (userId: string) => Promise<HandoffUser | null | undefined>;
  /**
   * Whether the caller's client still holds a live session for the user: an
   * unconsumed, unexpired refresh token. Access tokens are stateless JWTs that
   * stay valid after their grant is revoked, and the desktop app shares its
   * access token with local agent runs; requiring the refreshable session keeps
   * a copied or revoked access token from minting a fresh native grant.
   */
  hasLiveSession: (userId: string, clientId: string) => Promise<boolean>;
  policy?: NativeHandoffPolicy;
  provider: OIDCProvider;
  validateToken?: typeof validateOIDCJWT;
}

/**
 * Per-process fallback for deployments without Redis. It does not span
 * instances, so a horizontally scaled deployment without Redis gets a weaker
 * limit, never none.
 */
const localWindows = new Map<string, { count: number; resetAt: number }>();

const countLocally = (userId: string, now = Date.now()) => {
  for (const [key, entry] of localWindows) if (entry.resetAt <= now) localWindows.delete(key);
  const window = localWindows.get(userId);
  if (!window || window.resetAt <= now) {
    localWindows.set(userId, {
      count: 1,
      resetAt: now + NATIVE_HANDOFF_RATE_WINDOW_SECONDS * 1000,
    });
    return 1;
  }
  window.count += 1;
  return window.count;
};

/** @internal test helper */
export const resetNativeHandoffLocalLimits = () => localWindows.clear();

const audit = (
  event: 'issued' | 'rejected',
  fields: Record<string, string | number | null | undefined>,
) => {
  const line = `[OIDC] native handoff ${event}`;
  const payload = JSON.stringify(fields);
  if (event === 'issued') console.info(line, payload);
  else console.warn(line, payload);
};

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const normalizeIssuer = (issuer: string) => issuer.replace(/\/+$/, '');

const isLoopbackRedirect = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && !url.username;
};

/**
 * Issues one-time authorization codes for a native app on behalf of a signed-in
 * first-party app on the same machine.
 *
 * The desktop app authenticates with its own access token and passes along the
 * native app's PKCE challenge and loopback redirect URI. The code is bound to a
 * fresh grant of the native client, so the native app exchanges it at the
 * standard token endpoint with its own `code_verifier` and receives its own
 * refresh token. The desktop app's grant, refresh token and session are never
 * read, rotated or shared, and the desktop app cannot redeem the code itself
 * (it does not hold the verifier, and the code belongs to another client).
 */
export class NativeHandoffService {
  private readonly policy: NativeHandoffPolicy;
  private readonly validateToken: typeof validateOIDCJWT;

  constructor(private readonly deps: NativeHandoffDeps) {
    this.policy = deps.policy ?? OIDC_NATIVE_HANDOFF;
    this.validateToken = deps.validateToken ?? validateOIDCJWT;
  }

  get enabled() {
    return this.policy.from.length > 0 && this.policy.to.length > 0;
  }

  get issuer() {
    return normalizeIssuer(this.deps.provider.issuer);
  }

  /**
   * The native apps the caller may hand its session to, with what the desktop
   * app needs to recognise their executables. Requires the same caller token
   * as {@link issue}, so the list is not public.
   */
  async listTargets(accessToken: string | null | undefined) {
    this.assertEnabled();
    const caller = await this.authenticate(accessToken);

    return {
      issuer: this.issuer,
      sub: caller.sub,
      targets: this.policy.to.map(({ clientId, name, verification }) => ({
        client_id: clientId,
        name,
        verification: verification ?? {},
      })),
    };
  }

  async issue(
    accessToken: string | null | undefined,
    request: NativeHandoffRequest,
    context: NativeHandoffAuditContext = {},
  ): Promise<NativeHandoffIssued> {
    let callerClientId: string | undefined;
    let sub: string | undefined;
    const targetClientId = asString(request.client_id);

    try {
      this.assertEnabled();
      const caller = await this.authenticate(accessToken);
      callerClientId = caller.clientId;
      sub = caller.sub;

      const issued = await this.issueFor(caller, request);

      audit('issued', {
        expiresIn: issued.expires_in,
        from: callerClientId,
        grantId: issued.grantId,
        ip: context.ip,
        sub,
        to: targetClientId,
        userAgent: context.userAgent,
      });

      return { code: issued.code, expires_in: issued.expires_in, iss: issued.iss };
    } catch (error) {
      if (error instanceof NativeHandoffError) {
        audit('rejected', {
          error: error.code,
          from: callerClientId,
          ip: context.ip,
          reason: error.description,
          sub,
          to: targetClientId,
        });
      }
      throw error;
    }
  }

  private assertEnabled() {
    if (!this.enabled) {
      throw new NativeHandoffError('not_available', 'native handoff is not enabled');
    }
  }

  private async authenticate(accessToken: string | null | undefined) {
    if (!accessToken) {
      throw new NativeHandoffError('invalid_token', 'missing access token');
    }

    let result: Awaited<ReturnType<typeof validateOIDCJWT>>;
    try {
      result = await this.validateToken(accessToken);
    } catch (error) {
      log('caller token rejected: %O', error);
      throw new NativeHandoffError('invalid_token', 'access token is invalid or expired');
    }

    const { payload } = result;
    const clientId = asString(payload.client_id);
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];

    if (typeof payload.iss !== 'string' || normalizeIssuer(payload.iss) !== this.issuer) {
      throw new NativeHandoffError('invalid_token', 'access token was issued by another issuer');
    }
    if (!audiences.includes(API_AUDIENCE)) {
      throw new NativeHandoffError('invalid_token', 'access token is not for the API audience');
    }
    if (!clientId || !this.policy.from.includes(clientId)) {
      throw new NativeHandoffError(
        'unauthorized_client',
        'this client may not request a native handoff',
      );
    }

    const user = await this.deps.findUser(result.userId);
    if (!user || isOIDCUserBanned(user)) {
      throw new NativeHandoffError('access_denied', 'account is not active');
    }
    if (!(await this.deps.hasLiveSession(result.userId, clientId))) {
      throw new NativeHandoffError('invalid_token', 'the caller has no active session');
    }

    return { clientId, sub: result.userId };
  }

  private async issueFor(caller: { clientId: string; sub: string }, request: NativeHandoffRequest) {
    const { provider } = this.deps;

    const issuer = asString(request.issuer);
    if (!issuer) throw new NativeHandoffError('invalid_request', 'issuer is required');
    if (normalizeIssuer(issuer) !== this.issuer) {
      throw new NativeHandoffError('issuer_mismatch', `this server's issuer is ${this.issuer}`);
    }

    const expectedSub = request.sub === undefined ? undefined : asString(request.sub);
    if (request.sub !== undefined && !expectedSub) {
      throw new NativeHandoffError('invalid_request', 'sub must be a string');
    }
    if (expectedSub && expectedSub !== caller.sub) {
      throw new NativeHandoffError(
        'user_mismatch',
        'the requesting app is signed in as another user',
      );
    }

    const target = this.findTarget(asString(request.client_id));
    const client = await provider.Client.find(target.clientId);
    if (
      !client ||
      client.applicationType !== 'native' ||
      !client.grantTypeAllowed('authorization_code') ||
      !client.responseTypeAllowed('code')
    ) {
      throw new NativeHandoffError(
        'unauthorized_client',
        'target client is not a native authorization-code client',
      );
    }

    const redirectUri = asString(request.redirect_uri);
    if (
      !redirectUri ||
      !isLoopbackRedirect(redirectUri) ||
      !client.redirectUriAllowed(redirectUri)
    ) {
      throw new NativeHandoffError(
        'invalid_redirect_uri',
        'redirect_uri must be a loopback URI registered for the target client',
      );
    }

    const codeChallenge = asString(request.code_challenge);
    const method = request.code_challenge_method ?? 'S256';
    if (!codeChallenge || !CODE_CHALLENGE_PATTERN.test(codeChallenge) || method !== 'S256') {
      throw new NativeHandoffError(
        'invalid_request',
        'an S256 code_challenge of 43-128 base64url characters is required',
      );
    }

    const resource = request.resource === undefined ? API_AUDIENCE : asString(request.resource);
    if (resource !== API_AUDIENCE) {
      throw new NativeHandoffError('invalid_target', `resource must be ${API_AUDIENCE}`);
    }

    const scope = this.resolveScope(request.scope);

    await this.consumeRateLimit(caller.sub);

    // A fresh grant per handoff: the native app's token family starts here and
    // never shares an id with the desktop app's grant, so rotation, reuse
    // detection and revocation on one side cannot reach the other.
    const grant = new provider.Grant({ accountId: caller.sub, clientId: target.clientId });
    grant.addOIDCScope(scope);
    grant.addResourceScope(API_AUDIENCE, scope);
    const grantId = await grant.save();

    const code = new provider.AuthorizationCode({
      accountId: caller.sub,
      authTime: Math.floor(Date.now() / 1000),
      client,
      codeChallenge,
      codeChallengeMethod: 'S256',
      expiresIn: NATIVE_HANDOFF_CODE_TTL_SECONDS,
      grantId,
      gty: 'authorization_code',
      redirectUri,
      resource: API_AUDIENCE,
      scope,
    });
    const value = await code.save();

    return {
      code: value,
      expires_in: NATIVE_HANDOFF_CODE_TTL_SECONDS,
      grantId,
      iss: this.issuer,
    };
  }

  private findTarget(clientId: string | undefined): NativeHandoffTarget {
    const target = clientId ? this.policy.to.find((item) => item.clientId === clientId) : undefined;
    if (!target) {
      throw new NativeHandoffError(
        'unauthorized_client',
        'target client may not receive a native handoff',
      );
    }
    return target;
  }

  /**
   * The handoff never widens access: a code carries at most the scopes the
   * desktop app's own sign-in asks for (`profile email offline_access`, plus
   * `openid` for the id_token). The caller's access token cannot be used for a
   * per-scope comparison: its `scope` claim lists the API resource scopes, not
   * the OIDC scopes of the grant.
   */
  private resolveScope(requested: unknown) {
    if (requested !== undefined && typeof requested !== 'string') {
      throw new NativeHandoffError('invalid_scope', 'scope must be a string');
    }
    const scopes = (requested || DEFAULT_SCOPE).split(' ').filter(Boolean);
    if (!scopes.includes('openid')) {
      throw new NativeHandoffError('invalid_scope', 'openid scope is required');
    }
    const outside = scopes.filter((item) => !HANDOFF_SCOPES.has(item));
    if (outside.length > 0) {
      throw new NativeHandoffError('invalid_scope', `unsupported scope: ${outside.join(' ')}`);
    }
    return [...new Set(scopes)].join(' ');
  }

  private async consumeRateLimit(userId: string) {
    const shared = await this.deps.countRequest?.(userId).catch(() => undefined);
    const count = shared ?? countLocally(userId);
    if (count > NATIVE_HANDOFF_RATE_LIMIT) {
      throw new NativeHandoffError(
        'rate_limited',
        `at most ${NATIVE_HANDOFF_RATE_LIMIT} handoffs per ${NATIVE_HANDOFF_RATE_WINDOW_SECONDS} seconds`,
      );
    }
  }
}
