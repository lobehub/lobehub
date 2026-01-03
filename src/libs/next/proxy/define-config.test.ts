import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('define-config: callbackUrl generation in docker reverse proxy', () => {
  // Save original environment
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // @ts-expect-error - Setting NODE_ENV for testing
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3210';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('callbackUrl origin extraction logic', () => {
    it('should extract correct origin from x-forwarded-* headers', () => {
      // Simulate the logic used in define-config.ts
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              'x-forwarded-host': 'lobehub.com',
            };
            return headers[name.toLowerCase()] || null;
          }) as (name: string) => string | null,
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/settings',
          search: '',
        },
      };

      // This is the exact logic from define-config.ts
      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;

      expect(origin).toBe('https://lobehub.com');
      expect(mockReq.headers.get).toHaveBeenCalledWith('x-forwarded-proto');
      expect(mockReq.headers.get).toHaveBeenCalledWith('x-forwarded-host');
    });

    it('should fallback to host header when x-forwarded-host is missing', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              host: 'direct.com',
            };
            return headers[name.toLowerCase()] || null;
          }) as (name: string) => string | null,
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/settings',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;

      expect(origin).toBe('https://direct.com');
    });

    it('should fallback to nextUrl when no headers are present', () => {
      const mockReq = {
        headers: {
          get: vi.fn(() => null) as (name: string) => string | null,
        },
        nextUrl: {
          protocol: 'https:',
          host: 'example.com',
          pathname: '/settings',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;

      expect(origin).toBe('https://example.com');
    });
  });

  describe('callbackUrl building with pathname and search params', () => {
    it('should build complete callbackUrl with x-forwarded-* headers', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              'x-forwarded-host': 'lobehub.com',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/settings',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;
      const callbackUrl = `${origin}${mockReq.nextUrl.pathname}${mockReq.nextUrl.search}`;

      expect(callbackUrl).toBe('https://lobehub.com/settings');
    });

    it('should preserve search params in callbackUrl', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              'x-forwarded-host': 'lobehub.com',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/settings',
          search: '?hl=zh-CN',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;
      const callbackUrl = `${origin}${mockReq.nextUrl.pathname}${mockReq.nextUrl.search}`;

      expect(callbackUrl).toBe('https://lobehub.com/settings?hl=zh-CN');
    });

    it('should preserve multiple search params', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              'x-forwarded-host': 'example.com',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/settings',
          search: '?hl=zh-CN&redirect=/home',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;
      const callbackUrl = `${origin}${mockReq.nextUrl.pathname}${mockReq.nextUrl.search}`;

      expect(callbackUrl).toBe('https://example.com/settings?hl=zh-CN&redirect=/home');
    });
  });

  describe('real-world docker reverse proxy scenarios', () => {
    it('should handle production nginx reverse proxy', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              'x-forwarded-host': 'lobehub.com',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/settings',
          search: '?hl=zh-CN',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;
      const callbackUrl = `${origin}${mockReq.nextUrl.pathname}${mockReq.nextUrl.search}`;

      expect(callbackUrl).toBe('https://lobehub.com/settings?hl=zh-CN');
      expect(origin).not.toContain('0.0.0.0');
    });

    it('should handle docker compose development', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'http',
              'x-forwarded-host': 'localhost',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'http:',
          host: '0.0.0.0:3210',
          pathname: '/settings',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;
      const callbackUrl = `${origin}${mockReq.nextUrl.pathname}${mockReq.nextUrl.search}`;

      expect(callbackUrl).toBe('http://localhost/settings');
    });

    it('should handle non-standard port in forwarded host', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              'x-forwarded-host': 'example.com:8443',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/settings',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;
      const callbackUrl = `${origin}${mockReq.nextUrl.pathname}${mockReq.nextUrl.search}`;

      expect(callbackUrl).toBe('https://example.com:8443/settings');
    });

    it('should handle http protocol in development', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'http',
              'x-forwarded-host': 'localhost:8080',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'http:',
          host: '0.0.0.0:3210',
          pathname: '/onboard',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;
      const callbackUrl = `${origin}${mockReq.nextUrl.pathname}${mockReq.nextUrl.search}`;

      expect(callbackUrl).toBe('http://localhost:8080/onboard');
    });
  });

  describe('header priority and fallback', () => {
    it('should prioritize x-forwarded-host over host header', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              'x-forwarded-host': 'forwarded.com',
              host: 'direct.com',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/settings',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;

      expect(origin).toBe('https://forwarded.com');
      expect(host).toBe('forwarded.com');
    });

    it('should use host header when x-forwarded-host is missing', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              host: 'direct.com',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/settings',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;

      expect(origin).toBe('https://direct.com');
      expect(host).toBe('direct.com');
    });

    it('should use nextUrl.host when both forward headers are missing', () => {
      const mockReq = {
        headers: {
          get: vi.fn(() => null) as (name: string) => string | null,
        },
        nextUrl: {
          protocol: 'https:',
          host: 'example.com',
          pathname: '/settings',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;

      expect(origin).toBe('https://example.com');
      expect(host).toBe('example.com');
    });
  });

  describe('different routes and paths', () => {
    it('should handle root path', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              'x-forwarded-host': 'example.com',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;
      const callbackUrl = `${origin}${mockReq.nextUrl.pathname}${mockReq.nextUrl.search}`;

      expect(callbackUrl).toBe('https://example.com/');
    });

    it('should handle nested paths', () => {
      const mockReq = {
        headers: {
          get: vi.fn((name: string) => {
            const headers: Record<string, string> = {
              'x-forwarded-proto': 'https',
              'x-forwarded-host': 'example.com',
            };
            return headers[name.toLowerCase()] || null;
          }),
        },
        nextUrl: {
          protocol: 'https:',
          host: '0.0.0.0:3210',
          pathname: '/oauth/consent/app',
          search: '',
        },
      };

      const protocol = mockReq.headers.get('x-forwarded-proto') || mockReq.nextUrl.protocol.slice(0, -1);
      const host = mockReq.headers.get('x-forwarded-host') || mockReq.headers.get('host') || mockReq.nextUrl.host;
      const origin = `${protocol}://${host}`;
      const callbackUrl = `${origin}${mockReq.nextUrl.pathname}${mockReq.nextUrl.search}`;

      expect(callbackUrl).toBe('https://example.com/oauth/consent/app');
    });
  });
});
