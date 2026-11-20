import {
  ACCEPTANCE_EXTENSION_CLIENT_ID,
  ACCEPTANCE_EXTENSION_RESOURCE,
  ACCEPTANCE_REVIEW_SCOPE,
  ACCEPTANCE_REVIEW_TOKEN_TTL_SECONDS,
  acceptanceReviewFromResource,
  siteReviewFromResource,
} from '@lobechat/const';
import {
  MANAGED_DEVICE_JWT_PURPOSE,
  TUNNEL_ACCESS_JWT_PURPOSE,
  WORKSPACE_DEVICE_CONNECT_JWT_PURPOSE,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import type { JSONWebKeySet, JWK, JWK_RSA_Public } from 'jose';
import { calculateJwkThumbprint } from 'jose';

import { authEnv } from '@/envs/auth';

import {
  isAcceptanceExtensionClient,
  isAcceptanceReviewClient,
  isAcceptanceReviewIssued,
} from './acceptanceReview';

const log = debug('oidc-jwt');

/** See `@lobechat/types` `deviceGatewayToken`: these tokens are not logins. */
const DEVICE_GATEWAY_ONLY_PURPOSES = new Set<unknown>([
  MANAGED_DEVICE_JWT_PURPOSE,
  TUNNEL_ACCESS_JWT_PURPOSE,
  WORKSPACE_DEVICE_CONNECT_JWT_PURPOSE,
]);

/**
 * Get JWKS key string from environment
 * Uses JWKS_KEY which already has fallback to OIDC_JWKS_KEY in authEnv
 */
const getJwksKeyString = () => {
  return authEnv.JWKS_KEY;
};

/**
 * Get JWKS from environment variables
 * This JWKS is a JSON object containing RS256 private keys
 */
export const getJWKS = (): object => {
  try {
    const jwksString = getJwksKeyString();

    if (!jwksString) {
      throw new Error(
        'JWKS_KEY environment variable is required. Please use scripts/generate-oidc-jwk.mjs to generate JWKS.',
      );
    }

    // Attempt to parse JWKS JSON string
    const jwks = JSON.parse(jwksString);

    // Check if JWKS format is valid
    if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error('Invalid JWKS format: missing or empty keys array');
    }

    // Check if there is an RS256 algorithm key
    const hasRS256Key = jwks.keys.some((key: any) => key.alg === 'RS256' && key.kty === 'RSA');
    if (!hasRS256Key) {
      throw new Error('No RSA key with RS256 algorithm found in JWKS');
    }

    // oidc-provider 9.14+ rejects any `key_ops` member ("jwks.keys[0].key_ops is not
    // supported"), but keys exported through Web Crypto carry `key_ops: ['sign']`.
    // The provider only signs with these keys, so dropping the member keeps existing
    // JWKS_KEY values working without asking deployments to regenerate them.
    return {
      ...jwks,
      keys: jwks.keys.map(({ key_ops: _keyOps, ...key }: Record<string, unknown>) => key),
    };
  } catch (error) {
    console.error('Failed to parse JWKS:', error);
    throw new Error(`JWKS_KEY parse error: ${(error as Error).message}`, { cause: error });
  }
};

const isRsaSigningKey = (key: JWK): key is JWK_RSA_Public =>
  key.alg === 'RS256' &&
  key.kty === 'RSA' &&
  typeof key.e === 'string' &&
  typeof key.n === 'string';

const toPublicRsaKey = async (key: JWK_RSA_Public): Promise<JWK_RSA_Public> => ({
  alg: 'RS256',
  e: key.e,
  kid: key.kid ?? (await calculateJwkThumbprint(key)),
  kty: 'RSA',
  n: key.n,
  ...(key.use ? { use: key.use } : {}),
});

const getVerificationKeys = async () => {
  try {
    const jwksString = getJwksKeyString();

    if (!jwksString) {
      throw new Error('JWKS_KEY environment variable is not set');
    }

    const jwks = JSON.parse(jwksString) as JSONWebKeySet;

    if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error('Invalid JWKS format: missing or empty keys array');
    }

    const publicKeys = await Promise.all(jwks.keys.filter(isRsaSigningKey).map(toPublicRsaKey));
    if (publicKeys.length === 0) {
      throw new Error('No RSA key with RS256 algorithm found in JWKS');
    }

    const { importJWK } = await import('jose');

    // Validate configuration before token verification so a malformed JWK remains an
    // infrastructure error (500) instead of being misreported as invalid user auth (401).
    await Promise.all(publicKeys.map((key) => importJWK(key, 'RS256')));

    return publicKeys;
  } catch (error) {
    log('Failed to get JWKS public key: %O', error);
    throw new Error(`JWKS_KEY public key retrieval failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
};

const isSignatureVerificationError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED';

const verifyJwt = async (token: string, publicKeys: JWK_RSA_Public[]) => {
  const { createLocalJWKSet, decodeProtectedHeader, importJWK, jwtVerify } = await import('jose');
  const options = { algorithms: ['RS256'] };

  if (decodeProtectedHeader(token).kid) {
    return jwtVerify(token, createLocalJWKSet({ keys: publicKeys }), options);
  }

  // Tokens issued before this rotation support landed did not include `kid`.
  // Try each retained key only for those in-flight tokens; newly issued tokens
  // keep the exact-key lookup above and avoid ambiguous JWKS selection.
  let signatureError: unknown;
  for (const publicKey of publicKeys) {
    try {
      return await jwtVerify(token, await importJWK(publicKey, 'RS256'), options);
    } catch (error) {
      if (!isSignatureVerificationError(error)) throw error;
      signatureError = error;
    }
  }

  throw signatureError ?? new Error('No RSA key available for JWT verification');
};

/**
 * Validate OIDC JWT Access Token
 * @param token - JWT access token
 * @returns Parsed token payload and user information
 */
export const validateOIDCJWT = async (token: string) => {
  log('Starting OIDC JWT token validation');

  // JWKS / signing key retrieval is an infrastructure concern (misconfigured
  // env, malformed JWKS, key import failure). Let these errors propagate as
  // plain Error so upstream middleware maps them to 500 and triggers ops
  // alerts — treating them as 401 would incorrectly ask clients to re-auth
  // while the real problem is server-side.
  const publicKeys = await getVerificationKeys();

  try {
    const { payload } = await verifyJwt(token, publicKeys);

    log('JWT validation successful, payload: %O', payload);

    const userId = payload.sub;
    const clientId = payload.client_id;
    const aud = payload.aud;

    if (!userId) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'JWT token is missing user ID (sub)',
      });
    }

    // Review tokens live on third-party preview pages; they only open the review API.
    if (isAcceptanceReviewIssued(payload)) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Acceptance review tokens are not accepted here',
      });
    }

    if (DEVICE_GATEWAY_ONLY_PURPOSES.has(payload.purpose)) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Device gateway tokens are not accepted here',
      });
    }

    return {
      clientId,
      payload,
      tokenData: {
        aud,
        client_id: clientId,
        exp: payload.exp,
        iat: payload.iat,
        jti: payload.jti,
        purpose: payload.purpose as string | undefined,
        scope: payload.scope,
        sub: userId,
      },
      userId,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    log('JWT validation failed: %O', error);

    // Preserve the original jose error via `cause` so upstream middleware
    // can still inspect specific codes like `ERR_JWT_EXPIRED`.
    throw new TRPCError({
      cause: error,
      code: 'UNAUTHORIZED',
      message: `JWT token validation failed: ${(error as Error).message}`,
    });
  }
};

export const verifyAcceptanceReviewJWT = async (token: string) => {
  const publicKeys = await getVerificationKeys();
  const { payload } = await verifyJwt(token, publicKeys);
  const acceptance = acceptanceReviewFromResource(payload.aud);
  const acceptanceId = acceptance?.acceptanceId;
  const site = siteReviewFromResource(payload.aud);
  const clientId = payload.client_id as string | undefined;
  if (
    !(isAcceptanceReviewClient(clientId) || isAcceptanceExtensionClient(clientId)) ||
    (!acceptanceId && !site) ||
    !payload.sub
  )
    throw new Error('Not an acceptance review token');
  return {
    acceptanceId,
    acceptanceOrigin: acceptance?.origin,
    clientId,
    expiresAt: payload.exp,
    site,
    userId: payload.sub,
  };
};

export const verifyAcceptanceExtensionJWT = async (token: string) => {
  const publicKeys = await getVerificationKeys();
  const { payload } = await verifyJwt(token, publicKeys);
  if (
    !isAcceptanceExtensionClient(payload.client_id as string | undefined) ||
    payload.aud !== ACCEPTANCE_EXTENSION_RESOURCE ||
    !payload.sub
  )
    throw new Error('Not an acceptance extension token');
  return { userId: payload.sub };
};

// The extension trades its own access token for these, so the review API sees
// the same short-lived, single-target token the page client would get.
export const signAcceptanceReviewToken = async ({
  resource,
  userId,
}: {
  resource: string;
  userId: string;
}) => {
  const jwks = getJWKS() as JSONWebKeySet;
  const signingKey = jwks.keys.find((key) => key.alg === 'RS256' && key.kty === 'RSA')!;
  const { importJWK, SignJWT } = await import('jose');
  const kid = signingKey.kid ?? (await calculateJwkThumbprint(signingKey));
  const expiresAt = Math.floor(Date.now() / 1000) + ACCEPTANCE_REVIEW_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({
    client_id: ACCEPTANCE_EXTENSION_CLIENT_ID,
    scope: ACCEPTANCE_REVIEW_SCOPE,
  })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'at+jwt' })
    .setAudience(resource)
    .setSubject(userId)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(expiresAt)
    .sign(await importJWK(signingKey, 'RS256'));
  return { expiresAt, token };
};
