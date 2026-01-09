import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { correctOIDCUrl } from './correctOIDCUrl';

describe('correctOIDCUrl', () => {
  let mockRequest: NextRequest;
  let originalAppUrl: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Store original APP_URL and set default for tests
    originalAppUrl = process.env.APP_URL;
    process.env.APP_URL = 'https://example.com';

    // Create a mock request with a mutable headers property
    mockRequest = {
      headers: {
        get: vi.fn(),
      },
    } as unknown as NextRequest;
  });

  afterEach(() => {
    // Restore original APP_URL
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalAppUrl;
    }
  });

  describe('when no forwarded headers are present', () => {
    it('should return original URL when host matches and protocol is correct', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        return null;
      });

      const originalUrl = new URL('https://example.com/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('https://example.com/auth/callback');
      expect(result).toBe(originalUrl); // Should return the same object
    });

    it('should correct localhost URLs to request host preserving port', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
      expect(result.host).toBe('example.com:3000');
      expect(result.hostname).toBe('example.com');
      expect(result.port).toBe('3000');
      expect(result.protocol).toBe('http:');
    });

    it('should correct 127.0.0.1 URLs to request host preserving port', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        return null;
      });

      const originalUrl = new URL('http://127.0.0.1:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
      expect(result.host).toBe('example.com:3000');
      expect(result.hostname).toBe('example.com');
    });

    it('should correct 0.0.0.0 URLs to request host preserving port', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        return null;
      });

      const originalUrl = new URL('http://0.0.0.0:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
      expect(result.host).toBe('example.com:3000');
      expect(result.hostname).toBe('example.com');
    });

    it('should correct mismatched hostnames', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        return null;
      });

      const originalUrl = new URL('https://different.com/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('https://example.com/auth/callback');
      expect(result.host).toBe('example.com');
    });

    it('should handle request host with port when correcting localhost', () => {
      process.env.APP_URL = 'https://example.com:8080';
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com:8080';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('http://example.com:8080/auth/callback');
      expect(result.host).toBe('example.com:8080');
      expect(result.hostname).toBe('example.com');
      expect(result.port).toBe('8080');
    });
  });

  describe('when x-forwarded-host header is present', () => {
    it('should use x-forwarded-host over host header', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'internal.com';
        if (header === 'x-forwarded-host') return 'proxy.example.com';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('http://proxy.example.com:3000/auth/callback');
      expect(result.host).toBe('proxy.example.com:3000');
      expect(result.hostname).toBe('proxy.example.com');
    });

    it('should preserve path and query parameters', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'internal.com';
        if (header === 'x-forwarded-host') return 'proxy.example.com';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback?code=123&state=abc');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe(
        'http://proxy.example.com:3000/auth/callback?code=123&state=abc',
      );
      expect(result.pathname).toBe('/auth/callback');
      expect(result.search).toBe('?code=123&state=abc');
    });
  });

  describe('when x-forwarded-proto header is present', () => {
    it('should use x-forwarded-proto for protocol', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-proto') return 'https';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('https://example.com:3000/auth/callback');
      expect(result.protocol).toBe('https:');
    });

    it('should use x-forwarded-protocol as fallback', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-protocol') return 'https';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('https://example.com:3000/auth/callback');
      expect(result.protocol).toBe('https:');
    });

    it('should prioritize x-forwarded-proto over x-forwarded-protocol', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-proto') return 'https';
        if (header === 'x-forwarded-protocol') return 'http';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('https://example.com:3000/auth/callback');
      expect(result.protocol).toBe('https:');
    });
  });

  describe('protocol inference when no forwarded protocol', () => {
    it('should infer https when original URL uses https', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        return null;
      });

      const originalUrl = new URL('https://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('https://example.com:3000/auth/callback');
      expect(result.protocol).toBe('https:');
    });

    it('should default to http when original URL uses http', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
      expect(result.protocol).toBe('http:');
    });
  });

  describe('edge cases', () => {
    it('should return original URL when host is null', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return null;
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result).toBe(originalUrl);
      expect(result.toString()).toBe('http://localhost:3000/auth/callback');
    });

    it('should return original URL when host is "null" string', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'null';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result).toBe(originalUrl);
      expect(result.toString()).toBe('http://localhost:3000/auth/callback');
    });

    it('should return original URL when no host header is present', () => {
      (mockRequest.headers.get as any).mockImplementation(() => null);

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result).toBe(originalUrl);
      expect(result.toString()).toBe('http://localhost:3000/auth/callback');
    });

    it('should handle URL construction errors gracefully', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        return null;
      });

      const originalUrl = new URL(
        'http://localhost:3000/auth/callback?redirect=http://example.com',
      );

      // Spy on URL constructor to simulate an error on correction
      const urlSpy = vi.spyOn(global, 'URL');
      urlSpy.mockImplementationOnce((url: string | URL, base?: string | URL) => new URL(url, base)); // First call succeeds (original)
      urlSpy.mockImplementationOnce(() => {
        throw new Error('Invalid URL');
      }); // Second call fails (correction)

      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should return original URL when correction fails
      expect(result).toBe(originalUrl);
      expect(result.toString()).toBe(
        'http://localhost:3000/auth/callback?redirect=http://example.com',
      );

      urlSpy.mockRestore();
    });
  });

  describe('complex scenarios', () => {
    it('should handle complete proxy scenario with all headers', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'internal-service:3000';
        if (header === 'x-forwarded-host') return 'api.example.com';
        if (header === 'x-forwarded-proto') return 'https';
        return null;
      });

      const originalUrl = new URL('http://localhost:8080/api/auth/callback?code=xyz&state=def');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe(
        'https://api.example.com:8080/api/auth/callback?code=xyz&state=def',
      );
      expect(result.protocol).toBe('https:');
      expect(result.host).toBe('api.example.com:8080');
      expect(result.hostname).toBe('api.example.com');
      expect(result.pathname).toBe('/api/auth/callback');
      expect(result.search).toBe('?code=xyz&state=def');
    });

    it('should preserve URL hash fragments', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-proto') return 'https';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback#access_token=123');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result.toString()).toBe('https://example.com:3000/auth/callback#access_token=123');
      expect(result.hash).toBe('#access_token=123');
    });

    it('should reject forwarded host with non-standard port for security', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'internal.com:3000';
        if (header === 'x-forwarded-host') return 'example.com:8443';
        if (header === 'x-forwarded-proto') return 'https';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should fall back to host header because example.com:8443 doesn't match configured APP_URL
      expect(result.toString()).toBe('https://internal.com:3000/auth/callback');
    });

    it('should not need correction when URL hostname matches actual host', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        return null;
      });

      const originalUrl = new URL('http://example.com/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      expect(result).toBe(originalUrl); // Should return the same object
      expect(result.toString()).toBe('http://example.com/auth/callback');
    });
  });

  describe('Open Redirect protection', () => {
    it('should prevent redirection to malicious external domains via x-forwarded-host', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-host') return 'malicious.com';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should fall back to host header and not redirect to malicious.com
      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
    });

    it('should allow redirection to configured domain (example.com)', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should allow correction to example.com (configured in APP_URL)
      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
      expect(result.host).toBe('example.com:3000');
    });

    it('should allow redirection to subdomains of configured domain', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'api.example.com';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should allow correction to subdomain of example.com
      expect(result.toString()).toBe('http://api.example.com:3000/auth/callback');
      expect(result.host).toBe('api.example.com:3000');
    });

    it('should prevent redirection via x-forwarded-host to malicious domains', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com'; // Trusted internal host
        if (header === 'x-forwarded-host') return 'evil.com'; // Malicious forwarded host
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should fall back to request host (example.com) and not redirect to evil.com
      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
      expect(result.hostname).not.toBe('evil.com');
    });

    it('should allow localhost in development environment', () => {
      // Set APP_URL to localhost for development testing
      process.env.APP_URL = 'http://localhost:3000';

      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'localhost:8080';
        return null;
      });

      const originalUrl = new URL('http://127.0.0.1:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should allow correction to localhost in dev environment
      expect(result.toString()).toBe('http://localhost:8080/auth/callback');
      expect(result.host).toBe('localhost:8080');
    });

    it('should prevent redirection when APP_URL is not configured', () => {
      // Remove APP_URL to simulate missing configuration
      delete process.env.APP_URL;

      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-host') return 'any-domain.com';
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should fall back to host header when APP_URL is not configured and forwarded host is present
      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
    });

    it('should handle domains that look like subdomains but are not', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-host') return 'fakeexample.com'; // Not a subdomain of example.com
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should fall back to host header
      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
    });

    it('should reject invalid forwarded protocol', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-host') return 'example.com';
        if (header === 'x-forwarded-proto') return 'javascript'; // Invalid protocol
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should fall back to http protocol from URL
      expect(result.protocol).toBe('http:');
      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
    });

    it('should handle uppercase in forwarded protocol', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-host') return 'example.com';
        if (header === 'x-forwarded-proto') return 'HTTPS'; // Uppercase
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should normalize to lowercase
      expect(result.protocol).toBe('https:');
      expect(result.toString()).toBe('https://example.com:3000/auth/callback');
    });

    it('should handle multiple hosts in x-forwarded-host', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'internal.com';
        if (header === 'x-forwarded-host') return 'example.com,attacker.com'; // Multiple hosts
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should use the first (leftmost) host
      expect(result.hostname).toBe('example.com');
      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
    });

    it('should fall back to request host when forwarded host is invalid', () => {
      (mockRequest.headers.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-host') return 'evil.com'; // Invalid
        return null;
      });

      const originalUrl = new URL('http://localhost:3000/auth/callback');
      const result = correctOIDCUrl(mockRequest, originalUrl);

      // Should fall back to request host
      expect(result.hostname).toBe('example.com');
      expect(result.toString()).toBe('http://example.com:3000/auth/callback');
    });
  });
});
