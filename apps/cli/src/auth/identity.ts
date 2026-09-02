import crypto from 'node:crypto';

import { readCliApiKeyEnv } from '../constants/auth';
import { loadCredentials } from './credentials';

/**
 * A stable, non-secret fingerprint of the credentials this process would
 * authenticate with. Used to bind machine-local state (currently the persisted
 * workspace scope) to the account that produced it, so switching accounts —
 * or logging out and back in as someone else — cannot leave that state
 * pointing at a tenant the new identity has nothing to do with.
 *
 * Returns `undefined` when there is nothing to authenticate with; callers
 * should treat that as "no identity to bind to" rather than as a match.
 */
export function resolveIdentityFingerprint(): string | undefined {
  const envJwt = process.env.LOBEHUB_JWT;
  if (envJwt) {
    const sub = parseJwtSub(envJwt);
    return sub ? `user:${sub}` : undefined;
  }

  // An API key carries no readable subject, so hash the key itself: it is
  // stable per key and reveals nothing if the file is read.
  const apiKey = readCliApiKeyEnv();
  if (apiKey)
    return `apiKey:${crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}`;

  const stored = loadCredentials();
  if (!stored?.accessToken) return undefined;

  const sub = parseJwtSub(stored.accessToken);
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
