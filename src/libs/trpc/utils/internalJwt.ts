import debug from 'debug';
import { importJWK, jwtVerify, SignJWT } from 'jose';

import { authEnv } from '@/envs/auth';

const log = debug('lobe-internal-jwt');

const INTERNAL_JWT_PURPOSE = 'lobe-internal-call';

/**
 * Get RSA key pair from JWKS_KEY environment variable
 */
const getJwksKey = () => {
  const jwksString = authEnv.JWKS_KEY;

  if (!jwksString) {
    throw new Error('JWKS_KEY environment variable is not set');
  }

  const jwks = JSON.parse(jwksString);
  const rsaKey = jwks.keys.find((key: any) => key.alg === 'RS256' && key.kty === 'RSA');

  if (!rsaKey) {
    throw new Error('No RS256 RSA key found in JWKS');
  }

  return rsaKey;
};

/**
 * Get RSA private key for signing
 */
const getSigningKey = async () => {
  const rsaKey = getJwksKey();

  return {
    key: await importJWK(rsaKey, 'RS256'),
    kid: rsaKey.kid as string,
  };
};

/**
 * Get RSA public key for verification
 */
const getVerificationKey = async () => {
  const privateRsaKey = getJwksKey();

  // Create a "clean" JWK object containing only public key components
  // The essential fields for RSA public key are: kty, n, e
  const publicKeyJwk = {
    alg: privateRsaKey.alg,
    e: privateRsaKey.e,
    kid: privateRsaKey.kid,
    kty: privateRsaKey.kty,
    n: privateRsaKey.n,
    use: privateRsaKey.use,
  };

  // Remove any undefined fields to keep the object clean
  Object.keys(publicKeyJwk).forEach(
    (key) => (publicKeyJwk as any)[key] === undefined && delete (publicKeyJwk as any)[key],
  );

  return await importJWK(publicKeyJwk, 'RS256');
};

/**
 * Sign JWT for internal lambda → async calls
 * Uses JWKS private key with configurable expiration (default: 30s)
 * The JWT only proves the request is from lambda, payload is sent via LOBE_CHAT_AUTH_HEADER
 */
export const signInternalJWT = async (): Promise<string> => {
  const { key, kid } = await getSigningKey();

  return new SignJWT({ purpose: INTERNAL_JWT_PURPOSE })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setExpirationTime(authEnv.INTERNAL_JWT_EXPIRATION)
    .sign(key);
};

/**
 * Sign a short-lived OIDC-compatible JWT for a given user.
 * Used by server-side sandbox execution to authenticate CLI commands.
 * The token contains `sub: userId` and passes standard OIDC JWT validation.
 *
 * ⚠️ 5-minute expiry is intentionally short: this token is for gateway
 * WebSocket auth and quick CLI operations — NOT for long-running jobs.
 * For hetero-agent operations (Claude Code / Codex), use signOperationJwt().
 */
export const signUserJWT = async (userId: string): Promise<string> => {
  const { key, kid } = await getSigningKey();

  return new SignJWT({ purpose: 'cli-sandbox' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
};

/**
 * Sign a long-lived operation-scoped JWT for hetero-agent execution.
 *
 * Unlike signUserJWT (5-minute expiry for gateway / quick CLI auth), this
 * produces a token valid for 4 hours — enough for a Claude Code or Codex
 * session to run multiple tool calls without 401 errors on heteroIngest /
 * heteroFinish.
 *
 * The token contains `sub: userId` and `purpose: 'hetero-operation'` so
 * the validation middleware can distinguish operation tokens from short-lived
 * gateway tokens when minimum-scope enforcement is needed.
 */
export const signOperationJwt = async (userId: string): Promise<string> => {
  const { key, kid } = await getSigningKey();

  return new SignJWT({ purpose: 'hetero-operation' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('4h')
    .sign(key);
};

/**
 * Validate internal JWT from lambda → async calls
 * Returns true if valid, false otherwise
 */
export const validateInternalJWT = async (token: string): Promise<boolean> => {
  try {
    log('Validating internal JWT token');

    const publicKey = await getVerificationKey();

    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
    });

    // Verify this is an internal call token, not a user's OIDC token
    if (payload.purpose !== INTERNAL_JWT_PURPOSE) {
      log('JWT purpose mismatch: expected %s, got %s', INTERNAL_JWT_PURPOSE, payload.purpose);
      return false;
    }

    log('Internal JWT validation successful');
    return true;
  } catch (error) {
    log('Internal JWT validation failed: %O', error);
    return false;
  }
};
