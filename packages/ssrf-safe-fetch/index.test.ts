// @ts-ignore
import fetch from 'node-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ssrfSafeFetch } from './index';

// Mock node-fetch to avoid actual network requests
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

const mockFetch = fetch as any;

// Mock console.error to avoid noise in test output
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('ssrfSafeFetch', () => {
  const createMockResponse = (
    options: {
      arrayBuffer?: ArrayBuffer;
      headers?: Map<string, string>;
      status?: number;
      statusText?: string;
    } = {},
  ) => ({
    arrayBuffer: vi.fn().mockResolvedValue(options.arrayBuffer || new ArrayBuffer(10)),
    headers: options.headers || new Map(),
    status: options.status || 200,
    statusText: options.statusText || 'OK',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    delete process.env.SSRF_ALLOW_IP_ADDRESS_LIST;
    delete process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS;
  });

  describe('successful requests to allowed URLs', () => {
    it('should make a successful fetch request to external URL', async () => {
      const mockResponse = createMockResponse({
        headers: new Map([['content-type', 'application/json']]),
      });

      mockFetch.mockResolvedValue(mockResponse);

      const response = await ssrfSafeFetch('https://httpbin.org/get');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://httpbin.org/get',
        expect.objectContaining({
          agent: expect.any(Function),
        }),
      );
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
      expect(response.statusText).toBe('OK');
    });

    it('should pass through request options', async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      const requestOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' }),
      };

      await ssrfSafeFetch('https://httpbin.org/post', requestOptions);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://httpbin.org/post',
        expect.objectContaining({
          ...requestOptions,
          agent: expect.any(Function),
        }),
      );
    });
  });

  describe('SSRF protection for private IP addresses', () => {
    const privateIPs = [
      'http://127.0.0.1:8080',
      'http://localhost:3000',
      'http://192.168.1.1/api',
      'http://10.0.0.1/internal',
      'http://172.16.0.1/admin',
      'http://0.0.0.0:80',
    ];

    privateIPs.forEach((url) => {
      it(`should block requests to private IP: ${url}`, async () => {
        // The request-filtering-agent should throw an error for private IPs
        mockFetch.mockImplementation(() => {
          throw new Error('getaddrinfo ENOTFOUND');
        });

        await expect(ssrfSafeFetch(url)).rejects.toThrow(/Fetch failed/);

        expect(console.error).toHaveBeenCalledWith('Fetch error:', expect.any(Error));
      });
    });

    it('should allow private IPs when SSRF_ALLOW_PRIVATE_IP_ADDRESS is true', async () => {
      process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS = '1';

      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      const response = await ssrfSafeFetch('http://127.0.0.1:8080/api');

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
    });

    it('should allow specific IPs in SSRF_ALLOW_IP_ADDRESS_LIST', async () => {
      process.env.SSRF_ALLOW_IP_ADDRESS_LIST = '127.0.0.1,192.168.1.100';

      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      const response = await ssrfSafeFetch('http://127.0.0.1:8080/api');

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
    });
  });

  describe('SSRF protection for malicious URLs', () => {
    const privateHttpUrls = [
      'http://169.254.169.254/latest/meta-data/', // AWS metadata service
      'http://169.254.169.254:80/computeMetadata/v1/', // GCP metadata
      'http://metadata.google.internal/computeMetadata/v1/',
    ];

    privateHttpUrls.forEach((url) => {
      it(`should SSRF-block private HTTP URL: ${url}`, async () => {
        mockFetch.mockImplementation(() => {
          throw new Error(
            'DNS lookup 169.254.169.254 is not allowed. Because, It is private IP address.',
          );
        });

        await expect(ssrfSafeFetch(url)).rejects.toThrow(/SSRF blocked/);
      });
    });

    const unsupportedSchemeUrls = [
      'file:///etc/passwd', // File protocol
      'ftp://internal.company.com/secrets', // FTP protocol
    ];

    unsupportedSchemeUrls.forEach((url) => {
      it(`should reject unsupported scheme: ${url}`, async () => {
        mockFetch.mockImplementation(() => {
          throw new TypeError('Only HTTP(S) protocols are supported');
        });

        await expect(ssrfSafeFetch(url)).rejects.toThrow(/Fetch failed/);
      });
    });
  });

  describe('environment variable configuration', () => {
    it('should respect empty SSRF_ALLOW_IP_ADDRESS_LIST', async () => {
      process.env.SSRF_ALLOW_IP_ADDRESS_LIST = '';

      mockFetch.mockImplementation(() => {
        throw new Error('getaddrinfo ENOTFOUND');
      });

      await expect(ssrfSafeFetch('http://127.0.0.1:8080')).rejects.toThrow(/Fetch failed/);
    });

    it('should handle invalid environment variable values gracefully', async () => {
      process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS = 'invalid-value';

      mockFetch.mockImplementation(() => {
        throw new Error('getaddrinfo ENOTFOUND');
      });

      // Should default to false when env var is not 'true'
      await expect(ssrfSafeFetch('http://127.0.0.1:8080')).rejects.toThrow(/Fetch failed/);
    });
  });

  describe('error handling', () => {
    it('should throw error with descriptive message when fetch fails', async () => {
      const originalError = new Error('Network error');
      mockFetch.mockRejectedValue(originalError);

      await expect(ssrfSafeFetch('https://example.com')).rejects.toThrow(
        'Fetch failed: Network error',
      );

      expect(console.error).toHaveBeenCalledWith('Fetch error:', originalError);
    });

    it('should throw SSRF blocked error when request-filtering-agent blocks', async () => {
      const ssrfError = new Error(
        'DNS lookup 10.0.0.1(family:4, host:10.0.0.1) is not allowed. Because, It is private IP address.',
      );
      mockFetch.mockRejectedValue(ssrfError);

      await expect(ssrfSafeFetch('http://10.0.0.1/internal')).rejects.toThrow(/SSRF blocked/);

      expect(console.error).toHaveBeenCalledWith('SSRF protection blocked request:', ssrfError);
    });

    it('should handle non-Error thrown values', async () => {
      const nonErrorValue = 'String error';
      mockFetch.mockRejectedValue(nonErrorValue);

      await expect(ssrfSafeFetch('https://example.com')).rejects.toThrow(
        'Fetch failed: String error',
      );
    });

    it('should handle null/undefined error values', async () => {
      mockFetch.mockRejectedValue(null);

      await expect(ssrfSafeFetch('https://example.com')).rejects.toThrow('Fetch failed: null');
    });
  });

  describe('response conversion', () => {
    it('should convert node-fetch Response to standard Response', async () => {
      const mockArrayBuffer = new ArrayBuffer(10);
      const mockHeaders = new Map([
        ['content-type', 'application/json'],
        ['content-length', '10'],
      ]);

      const mockResponse = createMockResponse({
        arrayBuffer: mockArrayBuffer,
        headers: mockHeaders,
        status: 201,
        statusText: 'Created',
      });

      mockFetch.mockResolvedValue(mockResponse);

      const response = await ssrfSafeFetch('https://httpbin.org/status/201');

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(201);
      expect(response.statusText).toBe('Created');
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('content-length')).toBe('10');
      expect(mockResponse.arrayBuffer).toHaveBeenCalled();
    });

    it('should handle response with different status codes', async () => {
      const mockResponse = createMockResponse({
        arrayBuffer: new ArrayBuffer(0),
        status: 404,
        statusText: 'Not Found',
      });

      mockFetch.mockResolvedValue(mockResponse);

      const response = await ssrfSafeFetch('https://httpbin.org/status/404');

      expect(response.status).toBe(404);
      expect(response.statusText).toBe('Not Found');
    });

    it('should handle response with empty headers', async () => {
      const mockResponse = createMockResponse({
        arrayBuffer: new ArrayBuffer(0),
      });

      mockFetch.mockResolvedValue(mockResponse);

      const response = await ssrfSafeFetch('https://httpbin.org/get');

      expect(response.headers).toBeDefined();
      expect([...response.headers.entries()]).toEqual([]);
    });
  });

  describe('maxContentLength (response body cap)', () => {
    const buildBodyResponse = (chunks: Buffer[]) => ({
      // arrayBuffer should NOT be called when maxContentLength is set;
      // make it throw so the test fails loudly if the cap path falls through.
      arrayBuffer: vi.fn().mockImplementation(async () => {
        throw new Error('arrayBuffer should not be called when maxContentLength is set');
      }),
      body: (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
      headers: new Map([['content-type', 'text/html']]),
      status: 200,
      statusText: 'OK',
    });

    it('returns the full body when it fits within the cap', async () => {
      mockFetch.mockResolvedValue(buildBodyResponse([Buffer.from('hello '), Buffer.from('world')]));

      const response = await ssrfSafeFetch('https://example.com', {}, { maxContentLength: 1024 });

      expect(await response.text()).toBe('hello world');
    });

    it('truncates the body once the cap is reached and stops reading further chunks', async () => {
      const chunks = [
        Buffer.from('a'.repeat(60)),
        Buffer.from('b'.repeat(60)),
        Buffer.from('c'.repeat(60)),
      ];
      mockFetch.mockResolvedValue(buildBodyResponse(chunks));

      const response = await ssrfSafeFetch('https://example.com', {}, { maxContentLength: 100 });

      const text = await response.text();
      expect(text).toHaveLength(100);
      expect(text).toBe('a'.repeat(60) + 'b'.repeat(40));
    });

    it('returns an empty body when the response stream is null', async () => {
      mockFetch.mockResolvedValue({
        arrayBuffer: vi.fn(),
        body: null,
        headers: new Map(),
        status: 200,
        statusText: 'OK',
      });

      const response = await ssrfSafeFetch('https://example.com', {}, { maxContentLength: 1024 });

      expect(await response.text()).toBe('');
    });

    it('falls back to arrayBuffer when maxContentLength is not set', async () => {
      const mockResponse = createMockResponse({
        arrayBuffer: new TextEncoder().encode('legacy path').buffer as ArrayBuffer,
      });
      mockFetch.mockResolvedValue(mockResponse);

      const response = await ssrfSafeFetch('https://example.com');

      expect(mockResponse.arrayBuffer).toHaveBeenCalledTimes(1);
      expect(await response.text()).toBe('legacy path');
    });
  });

  /*
   * Regression tests for the production SIGABRT crashes on /trpc/tools/search.webSearch
   * (rss=2889MB heap=2473MB → V8 "allocation failed" → SIGABRT). These verify the cap
   * actually prevents unbounded buffering even when the source body is huge.
   */
  describe('OOM regression: bounded memory under oversized response bodies', () => {
    const ONE_MB = 1024 * 1024;
    const SIXTY_FOUR_KB = 64 * 1024;

    /**
     * Builds a mock response whose body generator tracks how many bytes it has
     * yielded into a shared counter. Lets us assert that we did not drain the
     * full source — the whole point of the cap is to stop pulling early.
     */
    const buildHugeBodyResponse = (
      counter: { bytesYielded: number },
      totalAvailableBytes: number,
    ) => {
      const chunk = Buffer.alloc(SIXTY_FOUR_KB, 0x61);
      const totalChunks = Math.ceil(totalAvailableBytes / chunk.length);

      async function* gen() {
        for (let i = 0; i < totalChunks; i++) {
          counter.bytesYielded += chunk.length;
          yield chunk;
        }
      }

      return {
        arrayBuffer: vi.fn().mockImplementation(async () => {
          throw new Error('arrayBuffer should not be called when maxContentLength is set');
        }),
        body: gen(),
        headers: new Map([['content-type', 'text/html']]),
        status: 200,
        statusText: 'OK',
      };
    };

    it('stops pulling chunks from the source once the cap is reached', async () => {
      // Source has 200 MB available; cap at 1 MB. Pre-fix would buffer all 200 MB
      // before the downstream truncation could apply.
      const counter = { bytesYielded: 0 };
      mockFetch.mockResolvedValue(buildHugeBodyResponse(counter, 200 * ONE_MB));

      const response = await ssrfSafeFetch(
        'https://huge.example.com',
        {},
        { maxContentLength: ONE_MB },
      );
      const body = await response.arrayBuffer();

      expect(body.byteLength).toBe(ONE_MB);
      // We should have pulled at most CAP + one chunk of slack (the last chunk
      // that triggered the break). Definitely not the full 200 MB.
      expect(counter.bytesYielded).toBeLessThanOrEqual(ONE_MB + SIXTY_FOUR_KB);
    });

    it('keeps total source pull bounded under CRAWL_CONCURRENCY=3 (production scenario)', async () => {
      // Three concurrent oversized fetches — matches the production setup where
      // pMap with concurrency=3 over 3 large search results triggered SIGABRT.
      const counter = { bytesYielded: 0 };
      mockFetch
        .mockResolvedValueOnce(buildHugeBodyResponse(counter, 100 * ONE_MB))
        .mockResolvedValueOnce(buildHugeBodyResponse(counter, 100 * ONE_MB))
        .mockResolvedValueOnce(buildHugeBodyResponse(counter, 100 * ONE_MB));

      const responses = await Promise.all([
        ssrfSafeFetch('https://a.example.com', {}, { maxContentLength: ONE_MB }),
        ssrfSafeFetch('https://b.example.com', {}, { maxContentLength: ONE_MB }),
        ssrfSafeFetch('https://c.example.com', {}, { maxContentLength: ONE_MB }),
      ]);

      for (const r of responses) {
        expect((await r.arrayBuffer()).byteLength).toBe(ONE_MB);
      }
      // Without the cap we would have pulled 300 MB. With cap=1 MB × 3 fetches,
      // expect ≤ 3 × (cap + one chunk slack).
      expect(counter.bytesYielded).toBeLessThanOrEqual(3 * (ONE_MB + SIXTY_FOUR_KB));
    });

    /*
     * Real heap-pressure test — only runs when --expose-gc is available
     * (e.g. `NODE_OPTIONS=--expose-gc bunx vitest run`). Skipped otherwise so CI
     * doesn't false-fail due to GC timing.
     */
    const itIfGc = typeof globalThis.gc === 'function' ? it : it.skip;
    itIfGc('heap delta stays bounded when a 50 MB body is fetched with a 1 MB cap', async () => {
      const counter = { bytesYielded: 0 };
      mockFetch.mockResolvedValue(buildHugeBodyResponse(counter, 50 * ONE_MB));

      globalThis.gc!();
      const before = process.memoryUsage().heapUsed;

      const response = await ssrfSafeFetch(
        'https://heavy.example.com',
        {},
        { maxContentLength: ONE_MB },
      );
      await response.arrayBuffer();

      globalThis.gc!();
      const after = process.memoryUsage().heapUsed;
      const deltaMB = (after - before) / ONE_MB;

      // Without the cap, delta would be ≥ 50 MB. With cap=1 MB, we expect
      // a few MB of overhead at most.
      expect(deltaMB).toBeLessThan(10);
    });
  });

  describe('integration scenarios', () => {
    it('should work with complex request configurations', async () => {
      process.env.SSRF_ALLOW_IP_ADDRESS_LIST = '127.0.0.1';
      process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS = '1';

      const mockResponse = createMockResponse({
        // @ts-ignore
        arrayBuffer: new TextEncoder().encode('{"success": true}'),
        headers: new Map([['content-type', 'application/json']]),
      });

      mockFetch.mockResolvedValue(mockResponse);

      const requestOptions = {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer token123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: 'test' }),
      };

      const response = await ssrfSafeFetch('https://api.example.com/data', requestOptions);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          ...requestOptions,
          agent: expect.any(Function),
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
    });

    it('should properly handle agent function with HTTPS URLs', async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await ssrfSafeFetch('https://secure.example.com/api');

      // Verify that the agent function is passed
      expect(mockFetch).toHaveBeenCalledWith(
        'https://secure.example.com/api',
        expect.objectContaining({
          agent: expect.any(Function),
        }),
      );
    });
  });
});
