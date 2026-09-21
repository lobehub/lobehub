import { AUTH_FAILURE_HEADER } from '@lobechat/desktop-bridge';

const JOSE_CODE_TO_FAILURE: Record<string, string> = {
  ERR_JWKS_NO_MATCHING_KEY: 'jwt_signature',
  ERR_JWS_INVALID: 'jwt_malformed',
  ERR_JWS_SIGNATURE_VERIFICATION_FAILED: 'jwt_signature',
  ERR_JWT_CLAIM_VALIDATION_FAILED: 'jwt_claims',
  ERR_JWT_EXPIRED: 'jwt_expired',
  ERR_JWT_INVALID: 'jwt_malformed',
};

const readCode = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

export const describeOIDCAuthFailure = (error: unknown): string => {
  const cause = (error as { cause?: unknown } | undefined)?.cause;
  const code = readCode(cause) ?? readCode(error);
  if (code && JOSE_CODE_TO_FAILURE[code]) return JOSE_CODE_TO_FAILURE[code];

  const message = error instanceof Error ? error.message : String(error);
  if (/JWKS/i.test(message)) return 'jwks_error';
  if (/missing user ID/i.test(message)) return 'jwt_no_sub';
  return 'jwt_invalid';
};

export const setAuthFailureHeader = (headers: Headers, failure: string) => {
  headers.set(AUTH_FAILURE_HEADER, failure);
};
