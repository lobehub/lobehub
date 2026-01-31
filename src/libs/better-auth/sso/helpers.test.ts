import { describe, expect, it } from 'vitest';

import { DEFAULT_OIDC_SCOPES, buildOidcConfig } from './helpers';

describe('DEFAULT_OIDC_SCOPES', () => {
  it('should contain standard OIDC scopes', () => {
    expect(DEFAULT_OIDC_SCOPES).toEqual(['openid', 'email', 'profile']);
  });
});

describe('buildOidcConfig', () => {
  const validInput = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    issuer: 'https://example.com',
    providerId: 'test-provider',
  };

  describe('successful configuration', () => {
    it('should build valid OIDC config with minimal required fields', () => {
      const result = buildOidcConfig(validInput);

      expect(result).toEqual({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        discoveryUrl: 'https://example.com/.well-known/openid-configuration',
        pkce: true,
        providerId: 'test-provider',
        scopes: DEFAULT_OIDC_SCOPES,
      });
    });

    it('should use custom scopes when provided', () => {
      const result = buildOidcConfig({
        ...validInput,
        scopes: ['openid', 'custom-scope'],
      });

      expect(result.scopes).toEqual(['openid', 'custom-scope']);
    });

    it('should disable PKCE when explicitly set to false', () => {
      const result = buildOidcConfig({
        ...validInput,
        pkce: false,
      });

      expect(result.pkce).toBe(false);
    });

    it('should enable PKCE by default', () => {
      const result = buildOidcConfig(validInput);

      expect(result.pkce).toBe(true);
    });

    it('should merge overrides into config', () => {
      const result = buildOidcConfig({
        ...validInput,
        overrides: {
          scopes: ['custom-override'],
        },
      });

      expect(result.scopes).toEqual(['custom-override']);
    });

    it('should allow overrides to override all fields', () => {
      const result = buildOidcConfig({
        ...validInput,
        overrides: {
          clientId: 'override-client-id',
          pkce: false,
        },
      });

      expect(result.clientId).toBe('override-client-id');
      expect(result.pkce).toBe(false);
    });
  });

  describe('discovery URL normalization', () => {
    it('should remove trailing slash from issuer', () => {
      const result = buildOidcConfig({
        ...validInput,
        issuer: 'https://example.com/',
      });

      expect(result.discoveryUrl).toBe('https://example.com/.well-known/openid-configuration');
    });

    it('should handle issuer with multiple trailing slashes', () => {
      const result = buildOidcConfig({
        ...validInput,
        issuer: 'https://example.com///',
      });

      expect(result.discoveryUrl).toBe('https://example.com//.well-known/openid-configuration');
    });

    it('should preserve issuer without trailing slash', () => {
      const result = buildOidcConfig({
        ...validInput,
        issuer: 'https://example.com',
      });

      expect(result.discoveryUrl).toBe('https://example.com/.well-known/openid-configuration');
    });

    it('should not add .well-known path if already present', () => {
      const result = buildOidcConfig({
        ...validInput,
        issuer: 'https://example.com/.well-known/openid-configuration',
      });

      expect(result.discoveryUrl).toBe('https://example.com/.well-known/openid-configuration');
    });

    it('should handle .well-known path in the middle of issuer URL', () => {
      const result = buildOidcConfig({
        ...validInput,
        issuer: 'https://example.com/.well-known/custom-path',
      });

      expect(result.discoveryUrl).toBe('https://example.com/.well-known/custom-path');
    });

    it('should trim whitespace from issuer', () => {
      const result = buildOidcConfig({
        ...validInput,
        issuer: '  https://example.com  ',
      });

      expect(result.discoveryUrl).toBe('https://example.com/.well-known/openid-configuration');
    });

    it('should trim whitespace and remove trailing slash', () => {
      const result = buildOidcConfig({
        ...validInput,
        issuer: '  https://example.com/  ',
      });

      expect(result.discoveryUrl).toBe('https://example.com/.well-known/openid-configuration');
    });
  });

  describe('validation and error handling', () => {
    it('should throw error when clientId is missing', () => {
      expect(() =>
        buildOidcConfig({
          ...validInput,
          clientId: undefined,
        }),
      ).toThrow('[Better-Auth] test-provider OAuth enabled but missing credentials');
    });

    it('should throw error when clientId is empty string', () => {
      expect(() =>
        buildOidcConfig({
          ...validInput,
          clientId: '',
        }),
      ).toThrow('[Better-Auth] test-provider OAuth enabled but missing credentials');
    });

    it('should throw error when clientSecret is missing', () => {
      expect(() =>
        buildOidcConfig({
          ...validInput,
          clientSecret: undefined,
        }),
      ).toThrow('[Better-Auth] test-provider OAuth enabled but missing credentials');
    });

    it('should throw error when clientSecret is empty string', () => {
      expect(() =>
        buildOidcConfig({
          ...validInput,
          clientSecret: '',
        }),
      ).toThrow('[Better-Auth] test-provider OAuth enabled but missing credentials');
    });

    it('should throw error when issuer is missing', () => {
      expect(() =>
        buildOidcConfig({
          ...validInput,
          issuer: undefined,
        }),
      ).toThrow('[Better-Auth] test-provider OAuth enabled but missing credentials');
    });

    it('should throw error when issuer is empty string', () => {
      expect(() =>
        buildOidcConfig({
          ...validInput,
          issuer: '',
        }),
      ).toThrow('[Better-Auth] test-provider OAuth enabled but missing credentials');
    });

    it('should throw error when issuer is only whitespace', () => {
      expect(() =>
        buildOidcConfig({
          ...validInput,
          issuer: '   ',
        }),
      ).toThrow('[Better-Auth] test-provider OAuth enabled but missing credentials');
    });

    it('should include providerId in error message', () => {
      expect(() =>
        buildOidcConfig({
          ...validInput,
          providerId: 'google',
          clientId: undefined,
        }),
      ).toThrow('[Better-Auth] google OAuth enabled but missing credentials');
    });

    it('should throw error when all credentials are missing', () => {
      expect(() =>
        buildOidcConfig({
          providerId: 'test-provider',
        }),
      ).toThrow('[Better-Auth] test-provider OAuth enabled but missing credentials');
    });
  });

  describe('edge cases', () => {
    it('should handle issuer with path segments', () => {
      const result = buildOidcConfig({
        ...validInput,
        issuer: 'https://example.com/auth/realms/master',
      });

      expect(result.discoveryUrl).toBe(
        'https://example.com/auth/realms/master/.well-known/openid-configuration',
      );
    });

    it('should handle issuer with port number', () => {
      const result = buildOidcConfig({
        ...validInput,
        issuer: 'https://example.com:8080',
      });

      expect(result.discoveryUrl).toBe('https://example.com:8080/.well-known/openid-configuration');
    });

    it('should handle issuer with query parameters', () => {
      const result = buildOidcConfig({
        ...validInput,
        issuer: 'https://example.com?tenant=abc',
      });

      expect(result.discoveryUrl).toBe(
        'https://example.com?tenant=abc/.well-known/openid-configuration',
      );
    });

    it('should handle empty scopes array', () => {
      const result = buildOidcConfig({
        ...validInput,
        scopes: [],
      });

      expect(result.scopes).toEqual([]);
    });

    it('should handle single scope in array', () => {
      const result = buildOidcConfig({
        ...validInput,
        scopes: ['openid'],
      });

      expect(result.scopes).toEqual(['openid']);
    });
  });
});
