import { describe, expect, it } from 'vitest';

import { NextRequest } from 'next/server';

import { buildCallbackUrl, getCallbackUrlOrigin } from './callback-url';

describe('callback-url: reverse proxy URL generation', () => {
  /**
   * Helper function to create a mock NextRequest with custom headers
   */
  const createMockRequest = (url: string, headers: Record<string, string> = {}): NextRequest => {
    // Create a real NextRequest with a valid URL
    const request = new NextRequest(new URL(url, 'http://test.com'), {
      headers: new Headers(headers),
    });

    // Manually set headers to ensure they're preserved
    Object.entries(headers).forEach(([key, value]) => {
      request.headers.set(key, value);
    });

    // Override the nextUrl properties to simulate the proxy scenario
    Object.defineProperty(request, 'nextUrl', {
      value: {
        protocol: new URL(url).protocol || 'https:',
        host: new URL(url).host || '0.0.0.0:3210',
        pathname: new URL(url).pathname || '/settings',
        search: new URL(url).search || '',
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
      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        host: 'direct.com',
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('https://direct.com');
    });

    it('should fallback to nextUrl when no proxy headers are present', () => {
      const mockRequest = createMockRequest('https://example.com/settings');

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('https://example.com');
    });

    it('should prioritize x-forwarded-host over host header', () => {
      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'forwarded.com',
        host: 'direct.com',
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('https://forwarded.com');
    });

    it('should handle non-standard port in forwarded host', () => {
      const mockRequest = createMockRequest('https://test.com/settings', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'example.com:8443',
      });

      const origin = getCallbackUrlOrigin(mockRequest);
      expect(origin).toBe('https://example.com:8443');
    });

    it('should handle http protocol in development', () => {
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
      const mockRequest = createMockRequest('https://test.com/settings?hl=zh-CN&redirect=/home', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'example.com',
      });

      const callbackUrl = buildCallbackUrl(mockRequest);
      expect(callbackUrl).toBe('https://example.com/settings?hl=zh-CN&redirect=/home');
    });

    it('should handle root path correctly', () => {
      const mockRequest = createMockRequest('https://test.com/', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'example.com',
      });

      const callbackUrl = buildCallbackUrl(mockRequest);
      expect(callbackUrl).toBe('https://example.com/');
    });

    it('should handle nested paths', () => {
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
});
