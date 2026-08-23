import { randomUUID } from 'node:crypto';

import debug from 'debug';
import { importJWK, jwtVerify, SignJWT } from 'jose';

import { authEnv } from '@/envs/auth';

const log = debug('lobe-internal-jwt');

const INTERNAL_JWT_PURPOSE = 'lobe-internal-call';
export const HETERO_OPERATION_JWT_ISSUER = 'urn:lobehub:internal';
export const HETERO_OPERATION_JWT_AUDIENCE = 'urn:lobehub:hetero-operation';
export const HETERO_OPERATION_JWT_PURPOSE = 'hetero-operation';

export type HeteroOperationCapability =
  'hetero:finish' | 'hetero:ingest' | 'hetero:intervention:read' | 'model:invoke';

export interface HeteroOperationJwtClaims {
  aud: typeof HETERO_OPERATION_JWT_AUDIENCE;
  capabilities: HeteroOperationCapability[];
  exp: number;
  iat: number;
  iss: typeof HETERO_OPERATION_JWT_ISSUER;
  jti: string;
  model?: string;
  operation_id: string;
  provider_id?: string;
  purpose: typeof HETERO_OPERATION_JWT_PURPOSE;
  sub: string;
  workspace_id?: string;
}

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
 * Sign an OIDC-compatible JWT for a given user.
 * Used by server-side sandbox execution to authenticate CLI commands.
 * The token contains `sub: userId` and passes standard OIDC JWT validation
 * (its `cli-sandbox` purpose is accepted by `oidcAuth`, unlike the narrow
 * `hetero-operation` token), so the sandbox's nested `lh` calls can reach
 * user-scoped endpoints (e.g. file upload).
 *
 * Defaults to a short 5-minute expiry for one-shot command auth; long-running
 * callers (e.g. a hetero CC/Codex sandbox run that streams for hours) pass a
 * run-length `expiration` so the token doesn't lapse mid-run.
 */
export const signUserJWT = async (
  userId: string,
  expiration: string | number = '5m',
): Promise<string> => {
  const { key, kid } = await getSigningKey();

  return new SignJWT({ purpose: 'cli-sandbox' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(key);
};

/**
 * Sign a long-lived OIDC-compatible JWT for hetero-agent operations.
 * Claude Code / Codex tasks can run for hours; this 4-hour token prevents
 * heteroIngest / heteroFinish from returning 401 mid-execution.
 */
export const signHeteroOperationJWT = async (params: {
  capabilities: HeteroOperationCapability[];
  model?: string;
  operationId: string;
  providerId?: string;
  userId: string;
  workspaceId?: string;
}): Promise<string> => {
  const { key, kid } = await getSigningKey();

  return new SignJWT({
    capabilities: params.capabilities,
    ...(params.model ? { model: params.model } : {}),
    operation_id: params.operationId,
    ...(params.providerId ? { provider_id: params.providerId } : {}),
    purpose: HETERO_OPERATION_JWT_PURPOSE,
    ...(params.workspaceId ? { workspace_id: params.workspaceId } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(HETERO_OPERATION_JWT_ISSUER)
    .setAudience(HETERO_OPERATION_JWT_AUDIENCE)
    .setSubject(params.userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('4h')
    .sign(key);
};

/** @deprecated Use the operation-bound signer. */
export const signOperationJwt = async (userId: string, operationId: string, workspaceId?: string) =>
  signHeteroOperationJWT({
    capabilities: ['hetero:ingest', 'hetero:finish', 'hetero:intervention:read'],
    operationId,
    userId,
    workspaceId,
  });

export const validateHeteroOperationClaims = (
  payload: Record<string, unknown>,
): HeteroOperationJwtClaims | null => {
  const capabilities = payload.capabilities;
  if (
    payload.iss !== HETERO_OPERATION_JWT_ISSUER ||
    payload.aud !== HETERO_OPERATION_JWT_AUDIENCE ||
    payload.purpose !== HETERO_OPERATION_JWT_PURPOSE ||
    typeof payload.sub !== 'string' ||
    typeof payload.operation_id !== 'string' ||
    typeof payload.jti !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    !Array.isArray(capabilities) ||
    !capabilities.every((capability) =>
      ['model:invoke', 'hetero:ingest', 'hetero:finish', 'hetero:intervention:read'].includes(
        capability as string,
      ),
    ) ||
    (payload.model !== undefined && typeof payload.model !== 'string') ||
    (payload.provider_id !== undefined && typeof payload.provider_id !== 'string') ||
    (payload.workspace_id !== undefined && typeof payload.workspace_id !== 'string')
  ) {
    return null;
  }

  return payload as unknown as HeteroOperationJwtClaims;
};

export const validateHeteroOperationJWT = async (
  token: string,
): Promise<HeteroOperationJwtClaims | null> => {
  try {
    const publicKey = await getVerificationKey();
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
      audience: HETERO_OPERATION_JWT_AUDIENCE,
      issuer: HETERO_OPERATION_JWT_ISSUER,
    });
    return validateHeteroOperationClaims(payload);
  } catch (error) {
    log('Heterogeneous operation JWT validation failed: %O', error);
    return null;
  }
};

/**
 * Sign a connection token for a WORKSPACE-owned device. The device gateway reads
 * the `workspace_id` claim and routes the socket to the `workspace:<id>`
 * principal (so every workspace member can reach the device), instead of the
 * signer's personal principal. Minted ONLY after the server has verified the
 * requester is a workspace admin — the gateway trusts this signed claim.
 */
export const signWorkspaceDeviceToken = async (workspaceId: string): Promise<string> => {
  const { key, kid } = await getSigningKey();

  return (
    new SignJWT({ purpose: 'workspace-device-connect', workspace_id: workspaceId })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setSubject(workspaceId)
      .setIssuedAt()
      // This token is NOT revocable (the gateway verifies signature + purpose +
      // principal only), so its TTL doubles as the worst-case window for a leaked
      // token or a demoted owner's device. Keep it short — aligned with the 4h
      // operation tokens. The CLI re-mints ahead of expiry (and re-checks owner via
      // wsOwnerProcedure each time), so a long-lived connection rolls over without
      // dropping; the TTL is a security bound, not a connection-lifetime limit.
      .setExpirationTime('4h')
      .sign(key)
  );
};

/**
 * Long-lived operation token for an agent run dispatched to a WORKSPACE device.
 * Mirrors {@link signOperationJwt} but carries `workspace_id` so the device's
 * gateway callbacks resolve to the workspace principal.
 */
export const signWorkspaceOperationJwt = async (
  workspaceId: string,
  userId: string,
  operationId: string,
): Promise<string> =>
  signHeteroOperationJWT({
    capabilities: ['hetero:ingest', 'hetero:finish', 'hetero:intervention:read'],
    operationId,
    userId,
    workspaceId,
  });

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
