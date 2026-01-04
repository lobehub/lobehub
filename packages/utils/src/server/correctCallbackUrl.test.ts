import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCallbackUrl, getCallbackUrlOrigin } from './correctCallbackUrl';

describe('callback-url: reverse proxy URL generation', () => {
  let originalAppUrl: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Store original APP_URL and set default for tests
    originalAppUrl = process.env.APP_URL;
    // Set a default APP_URL that matches most test scenarios
    process.env.APP_URL = 'https://lobehub.com';
  });

  afterEach(() => {
    // Restore original APP_URL
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalAppUrl;
    }
  });
  /**
   * Helper function to create a mock NextRequest with custom headers
   */
  const createMockRequest = (url: string, headers: Record<string, string> = {}): NextRequest => {
    const urlObj = new URL(url, 'http://test.com');

    // Create a real NextRequest with a valid URL
    const request = new NextRequest(urlObj, {
      headers: new Headers(headers),
    });

    // Manually set headers to ensure they're preserved
    Object.entries(headers).forEach(([key, value]) => {
      request.headers.set(key, value);
    });

    // Ensure host header is set from URL if not provided
    if (!headers.host && !headers['x-forwarded-host']) {
      request.headers.set('host', urlObj.host);
    }

    // Override the nextUrl properties to simulate the proxy scenario
    Object.defineProperty(request, 'nextUrl', {
      value: {
        protocol: urlObj.protocol || 'https:',
        host: urlObj.host || '0.0.0.0:3210',
        pathname: urlObj.pathname || '/settings',
        search: urlObj.search || '',
        href: url,
      },
      writable: false,
    });

    return request;
  };

  describe('getCallbackUrlOrigin', () => {
    it('should extract correct origin from x-forwarded-* headers in docker', () => {
      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'lobehub.com',
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('https://lobehub.com');
    });

    it('should fallback to host header when x-forwarded-host is missing', () => {
      // Set APP_URL to allow direct.com
      process.env.APP_URL = 'https://direct.com';

      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'host': 'direct.com',
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('https://direct.com');
    });

    it('should fallback to nextUrl when no proxy headers are present', () => {
      // Set APP_URL to allow example.com
      process.env.APP_URL = 'https://example.com';

      const mockRequest = createMockRequest('https://example.com/settings');

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('https://example.com');
    });

    it('should prioritize x-forwarded-host over host header', () => {
      // Set APP_URL to allow forwarded.com as a subdomain
      process.env.APP_URL = 'https://forwarded.com';

      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'forwarded.com',
        'host': 'direct.com',
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('https://forwarded.com');
    });

    it('should handle non-standard port in forwarded host', () => {
      // Set APP_URL to allow example.com:8443
      process.env.APP_URL = 'https://example.com:8443';

      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'example.com:8443',
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('https://example.com:8443');
    });

    it('should handle http protocol in development', () => {
      // Set APP_URL to allow localhost:8080
      process.env.APP_URL = 'http://localhost:8080';

      const mockRequest = createMockRequest('http://test.com/settings', {
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'localhost:8080',
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('http://localhost:8080');
    });
  });

  describe('buildCallbackUrl', () => {
    it('should build correct callbackUrl with x-forwarded-* headers', () => {
      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'lobehub.com',
      });

      const callbackUrl = buildCallbackUrl(mockRequest);
      expect(callbackUrl).toBe('https://lobehub.com/settings');
    });

    it('should preserve search params in callbackUrl', () => {
      const mockRequest = createMockRequest('https://test.com/settings?hl=zh-CN', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'lobehub.com',
      });

      const callbackUrl = buildCallbackUrl(mockRequest);
      expect(callbackUrl).toBe('https://lobehub.com/settings?hl=zh-CN');
    });

    it('should preserve multiple search params', () => {
      // Set APP_URL to allow example.com
      process.env.APP_URL = 'https://example.com';

      const mockRequest = createMockRequest('https://test.com/settings?hl=zh-CN&redirect=/home', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'example.com',
      });

      const callbackUrl = buildCallbackUrl(mockRequest);
      expect(callbackUrl).toBe('https://example.com/settings?hl=zh-CN&redirect=/home');
    });

    it('should handle root path correctly', () => {
      // Set APP_URL to allow example.com
      process.env.APP_URL = 'https://example.com';

      const mockRequest = createMockRequest('https://test.com/', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'example.com',
      });

      const callbackUrl = buildCallbackUrl(mockRequest);
      expect(callbackUrl).toBe('https://example.com/');
    });

    it('should handle nested paths', () => {
      // Set APP_URL to allow example.com
      process.env.APP_URL = 'https://example.com';

      const mockRequest = createMockRequest('https://test.com/oauth/consent/app', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'example.com',
      });

      const callbackUrl = buildCallbackUrl(mockRequest);
      expect(callbackUrl).toBe('https://example.com/oauth/consent/app');
    });
  });

  describe('real-world scenarios', () => {
    it('should handle production nginx reverse proxy', () => {
      const mockRequest = createMockRequest('https://test.com/settings?hl=zh-CN', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'lobehub.com',
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      const callbackUrl = buildCallbackUrl(mockRequest);

      expect(origin).toBe('https://lobehub.com');
      expect(callbackUrl).toBe('https://lobehub.com/settings?hl=zh-CN');
    });

    it('should handle docker compose development', () => {
      // Set APP_URL to allow localhost
      process.env.APP_URL = 'http://localhost';

      const mockRequest = createMockRequest('http://test.com/settings', {
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'localhost',
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      const callbackUrl = buildCallbackUrl(mockRequest);

      expect(origin).toBe('http://localhost');
      expect(callbackUrl).toBe('http://localhost/settings');
    });

    it('should handle direct access without proxy', () => {
      // Set APP_URL to allow example.com
      process.env.APP_URL = 'https://example.com';

      const mockRequest = createMockRequest('https://example.com/settings?hl=en-US');

      const origin = getCallbackUrlOrigin(mockRequest);
      const callbackUrl = buildCallbackUrl(mockRequest);

      expect(origin).toBe('https://example.com');
      expect(callbackUrl).toBe('https://example.com/settings?hl=en-US');
    });
  });

  describe('prevent incorrect callbackUrl in docker', () => {
    it('should not generate callbackUrl with 0.0.0.0 when proxy headers present', () => {
      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'lobehub.com',
      });

      const callbackUrl = buildCallbackUrl(mockRequest);

      // Should NOT contain the incorrect docker internal address
      expect(callbackUrl).not.toContain('0.0.0.0');

      // Should contain the correct external address
      expect(callbackUrl).toBe('https://lobehub.com/settings');
    });

    it('should preserve locale parameter with correct origin', () => {
      const mockRequest = createMockRequest('https://test.com/settings?hl=zh-CN', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'lobehub.com',
      });

      const callbackUrl = buildCallbackUrl(mockRequest);

      expect(callbackUrl).not.toContain('0.0.0.0');
      expect(callbackUrl).toBe('https://lobehub.com/settings?hl=zh-CN');
    });
  });

  describe('Open Redirect Attack Prevention', () => {
    it('should block redirect to malicious domain via x-forwarded-host', () => {
      // APP_URL is set to https://lobehub.com in beforeEach
      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'google.com', // Malicious domain
        'host': 'lobehub.com', // Trusted host
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      const callbackUrl = buildCallbackUrl(mockRequest);

      // Should fall back to lobehub.com, not use google.com
      expect(origin).not.toContain('google.com');
      expect(callbackUrl).not.toContain('google.com');
      expect(origin).toBe('https://lobehub.com');
    });

    it('should block redirect to evil.com via x-forwarded-host', () => {
      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.com', // Malicious domain
        'host': 'lobehub.com', // Trusted host
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      const callbackUrl = buildCallbackUrl(mockRequest);

      // Should fall back to lobehub.com, not use evil.com
      expect(origin).not.toContain('evil.com');
      expect(callbackUrl).not.toContain('evil.com');
      expect(origin).toBe('https://lobehub.com');
    });

    it('should allow subdomain of configured domain', () => {
      process.env.APP_URL = 'https://example.com';

      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.example.com', // Valid subdomain
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('https://api.example.com');
    });

    it('should block domain that looks like subdomain but is not', () => {
      process.env.APP_URL = 'https://example.com';

      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'fakeexample.com', // Not a subdomain
        'host': 'example.com', // Trusted host
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      const callbackUrl = buildCallbackUrl(mockRequest);

      // Should fall back to example.com, not use fakeexample.com
      expect(origin).not.toContain('fakeexample.com');
      expect(callbackUrl).not.toContain('fakeexample.com');
      expect(origin).toBe('https://example.com');
    });
  });
});
