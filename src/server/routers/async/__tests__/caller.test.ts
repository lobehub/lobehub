// @vitest-environment node
// Import the module under test after mocks are set up
import { createTRPCClient, httpLink } from '@trpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { createAsyncServerClient } from '../caller';

// Create mockable appEnv - use object property to allow mutation
const mockAppEnv: { APP_URL?: string; INTERNAL_APP_URL?: string | null | undefined } = {
  APP_URL: 'https://public.example.com',
  INTERNAL_APP_URL: 'http://localhost:3210',
};

// Mock dependencies before importing the module under test
vi.mock('@trpc/client', () => ({
  createTRPCClient: vi.fn(),
  httpLink: vi.fn((options) => options),
}));

vi.mock('@/envs/app', () => ({
  get appEnv() {
    return mockAppEnv;
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn(),
  },
}));

vi.mock('@/config/db', () => ({
  serverDBEnv: {
    KEY_VAULTS_SECRET: 'test-secret-key',
  },
}));

vi.mock('@/const/version', () => ({
  isDesktop: false,
}));

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signInternalJWT: vi.fn().mockResolvedValue('mock-internal-jwt-token'),
}));

describe('createAsyncServerClient - INTERNAL_APP_URL Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const mockEncrypt = vi.fn().mockResolvedValue('encrypted-payload-data');
    vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue({
      encrypt: mockEncrypt,
    } as any);
    vi.mocked(createTRPCClient).mockReturnValue({ _mockClient: true } as any);

    // Reset to default values by mutating the object
    mockAppEnv.APP_URL = 'https://public.example.com';
    mockAppEnv.INTERNAL_APP_URL = 'http://localhost:3210';
  });

  describe('URL selection logic', () => {
    it('should use INTERNAL_APP_URL when both APP_URL and INTERNAL_APP_URL are set', async () => {
      mockAppEnv.APP_URL = 'https://public.example.com';
      mockAppEnv.INTERNAL_APP_URL = 'http://localhost:3210';

      await createAsyncServerClient('user-123', { apiKey: 'test-key' });

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      expect(httpLinkOptions.url).toBe('http://localhost:3210/trpc/async');
      expect(httpLinkOptions.url).not.toContain('public.example.com');
    });

    it('should fall back to APP_URL when INTERNAL_APP_URL is not set in env', async () => {
      // Simulating the result of getInternalAppUrl() when INTERNAL_APP_URL is not in env
      // In this case, appEnv.INTERNAL_APP_URL would equal appEnv.APP_URL
      mockAppEnv.APP_URL = 'https://fallback.example.com';
      mockAppEnv.INTERNAL_APP_URL = 'https://fallback.example.com'; // getInternalAppUrl() returns APP_URL

      await createAsyncServerClient('user-456', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      expect(httpLinkOptions.url).toBe('https://fallback.example.com/trpc/async');
    });

    it('should use localhost to bypass CDN proxy', async () => {
      mockAppEnv.APP_URL = 'https://cdn-proxied.example.com';
      mockAppEnv.INTERNAL_APP_URL = 'http://127.0.0.1:3210';

      await createAsyncServerClient('user-789', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      expect(httpLinkOptions.url).toBe('http://127.0.0.1:3210/trpc/async');
      expect(httpLinkOptions.url).not.toContain('cdn-proxied');
    });

    it('should use internal service name in Docker network', async () => {
      mockAppEnv.APP_URL = 'https://public.example.com';
      mockAppEnv.INTERNAL_APP_URL = 'http://lobe-service:3210';

      await createAsyncServerClient('user-docker', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      expect(httpLinkOptions.url).toBe('http://lobe-service:3210/trpc/async');
    });

    it('should handle INTERNAL_APP_URL with trailing slash', async () => {
      mockAppEnv.INTERNAL_APP_URL = 'http://localhost:3210/';

      await createAsyncServerClient('user-trailing', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      // urlJoin should normalize the trailing slash
      expect(httpLinkOptions.url).toBe('http://localhost:3210/trpc/async');
    });

    it('should handle INTERNAL_APP_URL without trailing slash', async () => {
      mockAppEnv.INTERNAL_APP_URL = 'https://example.com';

      await createAsyncServerClient('user-no-trailing', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      expect(httpLinkOptions.url).toBe('https://example.com/trpc/async');
    });
  });

  describe('authentication and headers', () => {
    it('should include Authorization header with internal JWT token', async () => {
      await createAsyncServerClient('user-auth', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      expect(httpLinkOptions.headers).toHaveProperty('Authorization');
      expect(httpLinkOptions.headers.Authorization).toBe('mock-internal-jwt-token');
    });

    it('should encrypt and include user payload in x-lobe-chat-auth header', async () => {
      const testPayload = { apiKey: 'test-api-key-value', provider: 'openai' };
      const mockEncrypt = vi.fn().mockResolvedValue('test-encrypted-auth-data');
      vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValueOnce({
        encrypt: mockEncrypt,
      } as any);

      await createAsyncServerClient('user-encrypt', testPayload);

      expect(KeyVaultsGateKeeper.initWithEnvKey).toHaveBeenCalled();
      expect(mockEncrypt).toHaveBeenCalledWith(
        JSON.stringify({ payload: testPayload, userId: 'user-encrypt' }),
      );

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      // The header name is from LOBE_CHAT_AUTH_HEADER constant
      expect(httpLinkOptions.headers).toHaveProperty('Authorization');
      // The X-lobe-chat-auth header should be present
      expect(Object.keys(httpLinkOptions.headers)).toContain('X-lobe-chat-auth');
      expect(httpLinkOptions.headers['X-lobe-chat-auth']).toBe('test-encrypted-auth-data');
    });

    it('should include Vercel bypass secret when available', async () => {
      const originalEnv = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'test-bypass-value';

      await createAsyncServerClient('user-vercel', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      expect(httpLinkOptions.headers).toHaveProperty('x-vercel-protection-bypass');
      expect(httpLinkOptions.headers['x-vercel-protection-bypass']).toBe('test-bypass-value');

      // Restore original env
      if (originalEnv) {
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET = originalEnv;
      } else {
        delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      }
    });

    it('should not include Vercel bypass secret when not available', async () => {
      delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

      await createAsyncServerClient('user-no-vercel', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      expect(httpLinkOptions.headers).not.toHaveProperty('x-vercel-protection-bypass');
    });
  });

  describe('error handling', () => {
    it('should handle encryption failure gracefully', async () => {
      const mockEncrypt = vi.fn().mockRejectedValueOnce(new Error('Encryption failed'));
      vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValueOnce({
        encrypt: mockEncrypt,
      } as any);

      await expect(createAsyncServerClient('user-enc-fail', {})).rejects.toThrow(
        'Encryption failed',
      );

      expect(KeyVaultsGateKeeper.initWithEnvKey).toHaveBeenCalled();
    });

    it('should handle missing INTERNAL_APP_URL by using APP_URL', async () => {
      // When INTERNAL_APP_URL is not set in env, getInternalAppUrl() returns APP_URL
      mockAppEnv.APP_URL = 'https://only-app-url.com';
      mockAppEnv.INTERNAL_APP_URL = 'https://only-app-url.com'; // Result of fallback

      await createAsyncServerClient('user-null', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      // Should use APP_URL when INTERNAL_APP_URL is not set in environment
      expect(httpLinkOptions.url).toContain('only-app-url.com');
    });

    it('should handle empty string INTERNAL_APP_URL', async () => {
      mockAppEnv.APP_URL = 'https://fallback-from-empty.com';
      mockAppEnv.INTERNAL_APP_URL = '';

      await createAsyncServerClient('user-empty', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      // Empty string is falsy, so urlJoin will use it but result may vary
      expect(httpLinkOptions.url).toBeDefined();
      expect(httpLinkOptions.url).toContain('trpc/async');
    });

    it('should handle malformed URL gracefully', async () => {
      mockAppEnv.INTERNAL_APP_URL = 'not-a-valid-url';

      await createAsyncServerClient('user-malformed', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      // urlJoin will still create a result, even if base is malformed
      expect(httpLinkOptions.url).toBeDefined();
      expect(httpLinkOptions.url).toContain('trpc/async');
    });
  });

  describe('TRPC client configuration', () => {
    it('should configure httpLink with proper options', async () => {
      await createAsyncServerClient('user-config', {});

      expect(httpLink).toHaveBeenCalled();
      const httpLinkOptions = vi.mocked(httpLink).mock.calls[0][0];

      expect(httpLinkOptions).toHaveProperty('url');
      expect(httpLinkOptions).toHaveProperty('headers');
      expect(httpLinkOptions).toHaveProperty('transformer');
    });

    it('should pass httpLink result to createTRPCClient', async () => {
      await createAsyncServerClient('user-link', {});

      expect(createTRPCClient).toHaveBeenCalledWith({
        links: expect.arrayContaining([
          expect.objectContaining({
            url: expect.any(String),
            headers: expect.any(Object),
          }),
        ]),
      });
    });

    it('should return the created TRPC client', async () => {
      const client = await createAsyncServerClient('user-return', {});

      expect(client).toBeDefined();
      expect(client).toHaveProperty('_mockClient');
      expect((client as any)._mockClient).toBe(true);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle production deployment behind Cloudflare', async () => {
      mockAppEnv.APP_URL = 'https://lobechat.example.com';
      mockAppEnv.INTERNAL_APP_URL = 'http://localhost:3210';

      await createAsyncServerClient('prod-user', { apiKey: 'test-key' });

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      // Should use localhost to avoid CDN timeout
      expect(httpLinkOptions.url).toBe('http://localhost:3210/trpc/async');
    });

    it('should handle Docker Compose deployment with service names', async () => {
      mockAppEnv.APP_URL = 'https://public.example.com';
      mockAppEnv.INTERNAL_APP_URL = 'http://lobe-chat-database:3210';

      await createAsyncServerClient('docker-user', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      expect(httpLinkOptions.url).toBe('http://lobe-chat-database:3210/trpc/async');
    });

    it('should handle deployment without CDN (INTERNAL_APP_URL not set)', async () => {
      // When not using CDN, INTERNAL_APP_URL is not set, so it falls back to APP_URL
      mockAppEnv.APP_URL = 'https://direct-access.example.com';
      mockAppEnv.INTERNAL_APP_URL = 'https://direct-access.example.com'; // Result of getInternalAppUrl() fallback

      await createAsyncServerClient('direct-user', {});

      const config = vi.mocked(createTRPCClient).mock.calls[0][0];
      const httpLinkOptions = config.links[0] as any;

      // Should fallback to APP_URL
      expect(httpLinkOptions.url).toBe('https://direct-access.example.com/trpc/async');
    });
  });
});
