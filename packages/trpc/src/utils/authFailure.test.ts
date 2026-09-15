import { AUTH_FAILURE_HEADER } from '@lobechat/desktop-bridge';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { describeOIDCAuthFailure, setAuthFailureHeader } from './authFailure';

const joseError = (code: string) => Object.assign(new Error(code), { code });

describe('describeOIDCAuthFailure', () => {
  it('maps jose codes carried on TRPCError.cause', () => {
    const wrap = (code: string) =>
      new TRPCError({ cause: joseError(code), code: 'UNAUTHORIZED', message: 'x' });
    expect(describeOIDCAuthFailure(wrap('ERR_JWT_EXPIRED'))).toBe('jwt_expired');
    expect(describeOIDCAuthFailure(wrap('ERR_JWS_SIGNATURE_VERIFICATION_FAILED'))).toBe(
      'jwt_signature',
    );
    expect(describeOIDCAuthFailure(wrap('ERR_JWS_INVALID'))).toBe('jwt_malformed');
  });

  it('maps jose codes on a bare error', () => {
    expect(describeOIDCAuthFailure(joseError('ERR_JWT_EXPIRED'))).toBe('jwt_expired');
  });

  it('classifies JWKS infrastructure errors and missing sub', () => {
    expect(describeOIDCAuthFailure(new Error('JWKS_KEY environment variable is not set'))).toBe(
      'jwks_error',
    );
    expect(
      describeOIDCAuthFailure(
        new TRPCError({ code: 'UNAUTHORIZED', message: 'JWT token is missing user ID (sub)' }),
      ),
    ).toBe('jwt_no_sub');
  });

  it('falls back to jwt_invalid', () => {
    expect(describeOIDCAuthFailure(new Error('boom'))).toBe('jwt_invalid');
    expect(describeOIDCAuthFailure('string')).toBe('jwt_invalid');
  });
});

describe('setAuthFailureHeader', () => {
  it('writes the header', () => {
    const headers = new Headers();
    setAuthFailureHeader(headers, 'jwt_expired');
    expect(headers.get(AUTH_FAILURE_HEADER)).toBe('jwt_expired');
  });
});
