import { describe, expect, it, vi } from 'vitest';

import { extractBearerToken, extractOidcAuthToken } from './auth';

// Mock server-only imports that are not needed for unit testing pure functions
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

describe('extractBearerToken', () => {
  describe('valid Bearer tokens', () => {
    it('should extract a standard Bearer token', () => {
      expect(extractBearerToken('Bearer mytoken123')).toBe('mytoken123');
    });

    it('should extract a long Bearer token', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
      expect(extractBearerToken(`Bearer ${token}`)).toBe(token);
    });

    it('should trim whitespace around the token itself', () => {
      expect(extractBearerToken('Bearer   trimmed-token  ')).toBe('trimmed-token');
    });

    it('should trim leading/trailing whitespace from the header', () => {
      expect(extractBearerToken('  Bearer mytoken  ')).toBe('mytoken');
    });
  });

  describe('case insensitivity', () => {
    it('should accept lowercase "bearer"', () => {
      expect(extractBearerToken('bearer mytoken')).toBe('mytoken');
    });

    it('should accept uppercase "BEARER"', () => {
      expect(extractBearerToken('BEARER mytoken')).toBe('mytoken');
    });

    it('should accept mixed case "BeArEr"', () => {
      expect(extractBearerToken('BeArEr mytoken')).toBe('mytoken');
    });
  });

  describe('invalid or missing tokens', () => {
    it('should return null when header is undefined', () => {
      expect(extractBearerToken(undefined)).toBeNull();
    });

    it('should return null when header is null', () => {
      expect(extractBearerToken(null)).toBeNull();
    });

    it('should return null when header is an empty string', () => {
      expect(extractBearerToken('')).toBeNull();
    });

    it('should return null when header has no Bearer prefix', () => {
      expect(extractBearerToken('Token mytoken123')).toBeNull();
    });

    it('should return null when header is just "Bearer" with no token', () => {
      expect(extractBearerToken('Bearer')).toBeNull();
    });

    it('should return null when header is "Bearer " with only whitespace', () => {
      expect(extractBearerToken('Bearer   ')).toBeNull();
    });

    it('should return null for a random string', () => {
      expect(extractBearerToken('some-random-string')).toBeNull();
    });

    it('should return null when only whitespace is provided', () => {
      expect(extractBearerToken('   ')).toBeNull();
    });
  });
});

describe('extractOidcAuthToken', () => {
  describe('valid Oidc-Auth tokens', () => {
    it('should extract a standard Oidc-Auth token', () => {
      expect(extractOidcAuthToken('Oidc-Auth mytoken123')).toBe('mytoken123');
    });

    it('should extract a JWT-like Oidc-Auth token', () => {
      const token = 'eyJhbGciOiJSUzI1NiJ9.claims.sig';
      expect(extractOidcAuthToken(`Oidc-Auth ${token}`)).toBe(token);
    });

    it('should trim whitespace around the token itself', () => {
      expect(extractOidcAuthToken('Oidc-Auth   trimmed  ')).toBe('trimmed');
    });

    it('should trim leading/trailing whitespace from the header', () => {
      expect(extractOidcAuthToken('  Oidc-Auth mytoken  ')).toBe('mytoken');
    });
  });

  describe('case insensitivity', () => {
    it('should accept lowercase "oidc-auth"', () => {
      expect(extractOidcAuthToken('oidc-auth mytoken')).toBe('mytoken');
    });

    it('should accept uppercase "OIDC-AUTH"', () => {
      expect(extractOidcAuthToken('OIDC-AUTH mytoken')).toBe('mytoken');
    });

    it('should accept mixed case "OiDc-AuTh"', () => {
      expect(extractOidcAuthToken('OiDc-AuTh mytoken')).toBe('mytoken');
    });
  });

  describe('invalid or missing tokens', () => {
    it('should return null when header is undefined', () => {
      expect(extractOidcAuthToken(undefined)).toBeNull();
    });

    it('should return null when header is null', () => {
      expect(extractOidcAuthToken(null)).toBeNull();
    });

    it('should return null when header is an empty string', () => {
      expect(extractOidcAuthToken('')).toBeNull();
    });

    it('should return null when header has no Oidc-Auth prefix', () => {
      expect(extractOidcAuthToken('Bearer mytoken123')).toBeNull();
    });

    it('should return null when header is just "Oidc-Auth" with no token', () => {
      expect(extractOidcAuthToken('Oidc-Auth')).toBeNull();
    });

    it('should return null when header is "Oidc-Auth " with only whitespace', () => {
      expect(extractOidcAuthToken('Oidc-Auth   ')).toBeNull();
    });

    it('should return null for a random string', () => {
      expect(extractOidcAuthToken('some-random-string')).toBeNull();
    });

    it('should return null when only whitespace is provided', () => {
      expect(extractOidcAuthToken('   ')).toBeNull();
    });
  });
});
