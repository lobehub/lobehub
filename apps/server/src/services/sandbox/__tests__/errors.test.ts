import { describe, expect, it } from 'vitest';

import { isSandboxAccessDeniedError, isSandboxAuthError } from '../errors';

describe('isSandboxAuthError', () => {
  it.each(['invalid_token', 'token_expired', 'unauthorized'])(
    'matches the auth code %s',
    (name) => {
      expect(isSandboxAuthError({ name })).toBe(true);
    },
  );

  it.each([
    'The INVALID_TOKEN was rejected by Market',
    'Your Token Expired, please re-authenticate',
    'Request failed: UNAUTHORIZED',
  ])('matches the message %s case-insensitively', (message) => {
    expect(isSandboxAuthError({ message })).toBe(true);
  });

  it.each([
    { message: 'no such file', name: 'not_found' },
    { message: 'export failed' },
    { name: 'forbidden' },
  ])('does not match non-auth error %o', (error) => {
    expect(isSandboxAuthError(error)).toBe(false);
  });

  it('does not match a missing error', () => {
    expect(isSandboxAuthError(undefined)).toBe(false);
  });
});

describe('isSandboxAccessDeniedError', () => {
  it('matches the structured access-denied marker', () => {
    expect(isSandboxAccessDeniedError({ kind: 'stop' })).toBe(true);
  });

  it.each([{ kind: 'retry' }, { kind: 'replan' }, { message: 'denied' }])(
    'does not match %o',
    (error) => {
      expect(isSandboxAccessDeniedError(error)).toBe(false);
    },
  );

  it('does not match a missing error', () => {
    expect(isSandboxAccessDeniedError(undefined)).toBe(false);
  });
});
