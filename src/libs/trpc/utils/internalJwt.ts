import debug from 'debug';
import { importJWK, jwtVerify,SignJWT } from 'jose';

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
