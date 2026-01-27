import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractBearerToken, extractOidcAuthToken, getUserAuth } from '../auth';

vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers()),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: {
          id: 'better-auth-user-id',
        },
      }),
    },
  },
}));

describe('getUserAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return better auth session', async () => {
    const auth = await getUserAuth();

    expect(auth).toEqual({
      betterAuth: {
        user: {
          id: 'better-auth-user-id',
        },
      },
      userId: 'better-auth-user-id',
    });
  });
});

describe('extractBearerToken', () => {
  it('should return the token when authHeader is valid', () => {
    const token = 'test-token';
    const authHeader = `Bearer ${token}`;
    expect(extractBearerToken(authHeader)).toBe(token);
  });

  it('should return null when authHeader is missing', () => {
    expect(extractBearerToken()).toBeNull();
  });

  it('should return null when authHeader is null', () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it('should return null when authHeader does not start with "Bearer "', () => {
    const authHeader = 'Invalid format';
    expect(extractBearerToken(authHeader)).toBeNull();
  });

  it('should return null when authHeader is only "Bearer"', () => {
    const authHeader = 'Bearer';
    expect(extractBearerToken(authHeader)).toBeNull();
  });

  it('should return null when authHeader is an empty string', () => {
    const authHeader = '';
    expect(extractBearerToken(authHeader)).toBeNull();
  });

  it('should handle extra spaces correctly', () => {
    const token = 'test-token-with-spaces';
    const authHeaderWithExtraSpaces = ` Bearer   ${token}  `;
    const authHeaderLeadingSpace = ` Bearer ${token}`;
    const authHeaderTrailingSpace = `Bearer ${token} `;
    const authHeaderMultipleSpacesBetween = `Bearer    ${token}`;

    expect(extractBearerToken(authHeaderWithExtraSpaces)).toBe(token);
    expect(extractBearerToken(authHeaderLeadingSpace)).toBe(token);
    expect(extractBearerToken(authHeaderTrailingSpace)).toBe(token);
    expect(extractBearerToken(authHeaderMultipleSpacesBetween)).toBe(token);
  });

  it('should handle case-insensitive Bearer prefix', () => {
    const token = 'test-token';
    expect(extractBearerToken('bearer test-token')).toBe(token);
    expect(extractBearerToken('BEARER test-token')).toBe(token);
    expect(extractBearerToken('BeArEr test-token')).toBe(token);
  });

  it('should extract long JWT-like token', () => {
    const jwtToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const authHeader = `Bearer ${jwtToken}`;
    expect(extractBearerToken(authHeader)).toBe(jwtToken);
  });

  it('should extract token with special characters', () => {
    const token = 'token-with_special.chars+and/numbers123';
    const authHeader = `Bearer ${token}`;
    expect(extractBearerToken(authHeader)).toBe(token);
  });

  it('should return null for header with only spaces after Bearer', () => {
    expect(extractBearerToken('Bearer   ')).toBeNull();
  });

  it('should return null when using wrong prefix', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });
});

describe('extractOidcAuthToken', () => {
  it('should return the token when authHeader is valid', () => {
    const token = 'test-oidc-token';
    const authHeader = `Oidc-Auth ${token}`;
    expect(extractOidcAuthToken(authHeader)).toBe(token);
  });

  it('should return null when authHeader is missing', () => {
    expect(extractOidcAuthToken()).toBeNull();
  });

  it('should return null when authHeader is null', () => {
    expect(extractOidcAuthToken(null)).toBeNull();
  });

  it('should return null when authHeader is an empty string', () => {
    expect(extractOidcAuthToken('')).toBeNull();
  });

  it('should return null when authHeader does not start with "Oidc-Auth "', () => {
    expect(extractOidcAuthToken('Invalid format')).toBeNull();
    expect(extractOidcAuthToken('Bearer token123')).toBeNull();
  });

  it('should return null when authHeader is only "Oidc-Auth"', () => {
    expect(extractOidcAuthToken('Oidc-Auth')).toBeNull();
  });

  it('should return null for header with only spaces after Oidc-Auth', () => {
    expect(extractOidcAuthToken('Oidc-Auth   ')).toBeNull();
  });

  it('should handle case-insensitive Oidc-Auth prefix', () => {
    const token = 'test-token';
    expect(extractOidcAuthToken('oidc-auth test-token')).toBe(token);
    expect(extractOidcAuthToken('OIDC-AUTH test-token')).toBe(token);
    expect(extractOidcAuthToken('OiDc-AuTh test-token')).toBe(token);
  });

  it('should handle extra spaces correctly', () => {
    const token = 'test-oidc-token';
    const authHeaderWithExtraSpaces = ` Oidc-Auth   ${token}  `;
    const authHeaderLeadingSpace = ` Oidc-Auth ${token}`;
    const authHeaderTrailingSpace = `Oidc-Auth ${token} `;
    const authHeaderMultipleSpacesBetween = `Oidc-Auth    ${token}`;

    expect(extractOidcAuthToken(authHeaderWithExtraSpaces)).toBe(token);
    expect(extractOidcAuthToken(authHeaderLeadingSpace)).toBe(token);
    expect(extractOidcAuthToken(authHeaderTrailingSpace)).toBe(token);
    expect(extractOidcAuthToken(authHeaderMultipleSpacesBetween)).toBe(token);
  });

  it('should extract long JWT-like token from Oidc-Auth header', () => {
    const jwtToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const authHeader = `Oidc-Auth ${jwtToken}`;
    expect(extractOidcAuthToken(authHeader)).toBe(jwtToken);
  });

  it('should extract token with special characters', () => {
    const token = 'token-with_special.chars+and/numbers123';
    const authHeader = `Oidc-Auth ${token}`;
    expect(extractOidcAuthToken(authHeader)).toBe(token);
  });

  it('should return null for partial prefix match', () => {
    expect(extractOidcAuthToken('Oidc token123')).toBeNull();
    expect(extractOidcAuthToken('Oidc-Authtoken123')).toBeNull();
  });

  it('should return null when authHeader has only spaces', () => {
    expect(extractOidcAuthToken('   ')).toBeNull();
  });
});
