import { readCliApiKeyEnv } from '../constants/auth';
import { loadCredentials } from './credentials';

/**
 * The account this process would authenticate as, taken from the `sub` claim of
 * whichever token is in play. Used to bind machine-local state (currently the
 * persisted workspace scope) to the account that produced it, so switching
 * accounts — or logging out and back in as someone else — cannot leave that
 * state pointing at a tenant the new identity has nothing to do with.
 *
 * Only public claims are read. An API key carries no readable subject and the
 * only local way to derive one would be to digest the key itself, which would
 * put a secret-derived artifact on disk for no benefit — so API-key mode
 * returns `undefined` and scope has to come from `LOBEHUB_WORKSPACE_ID`.
 *
 * Callers must treat `undefined` as "no identity to bind to", never as a match.
 */
export function resolveIdentityFingerprint(): string | undefined {
  // Must follow the same precedence `getAuthAndServer` uses to pick credentials.
  // Reading past an API key to the stored login would bind the scope to one
  // account while the request authenticates as another.
  const envJwt = process.env.LOBEHUB_JWT;
  if (envJwt) return userIdentity(envJwt);

  if (readCliApiKeyEnv()) return undefined;

  const stored = loadCredentials();
  return stored?.accessToken ? userIdentity(stored.accessToken) : undefined;
}

function userIdentity(token: string): string | undefined {
  const sub = parseJwtSub(token);
  return sub ? `user:${sub}` : undefined;
}

/** Parse the `sub` claim from a JWT without verifying the signature. */
function parseJwtSub(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return typeof payload.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}
