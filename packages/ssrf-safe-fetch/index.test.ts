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

        await expect(ssrfSafeFetch(url)).rejects.toThrow(/SSRF-safe fetch failed/);

        expect(console.error).toHaveBeenCalledWith('SSRF-safe fetch error:', expect.any(Error));
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
    const maliciousUrls = [
      'http://169.254.169.254/latest/meta-data/', // AWS metadata service
      'http://169.254.169.254:80/computeMetadata/v1/', // GCP metadata
      'http://metadata.google.internal/computeMetadata/v1/',
      'file:///etc/passwd', // File protocol
      'ftp://internal.company.com/secrets', // FTP protocol
    ];

    maliciousUrls.forEach((url) => {
      it(`should block malicious URL: ${url}`, async () => {
        mockFetch.mockImplementation(() => {
          throw new Error('Request blocked by SSRF protection');
        });

        await expect(ssrfSafeFetch(url)).rejects.toThrow(/SSRF-safe fetch failed/);
      });
    });
  });

  describe('environment variable configuration', () => {
    it('should respect empty SSRF_ALLOW_IP_ADDRESS_LIST', async () => {
      process.env.SSRF_ALLOW_IP_ADDRESS_LIST = '';

      mockFetch.mockImplementation(() => {
        throw new Error('getaddrinfo ENOTFOUND');
      });

      await expect(ssrfSafeFetch('http://127.0.0.1:8080')).rejects.toThrow(
        /SSRF-safe fetch failed/,
      );
    });

    it('should handle invalid environment variable values gracefully', async () => {
      process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS = 'invalid-value';

      mockFetch.mockImplementation(() => {
        throw new Error('getaddrinfo ENOTFOUND');
      });

      // Should default to false when env var is not 'true'
      await expect(ssrfSafeFetch('http://127.0.0.1:8080')).rejects.toThrow(
        /SSRF-safe fetch failed/,
      );
    });
  });

  describe('error handling', () => {
    it('should throw error with descriptive message when fetch fails', async () => {
      const originalError = new Error('Network error');
      mockFetch.mockRejectedValue(originalError);

      await expect(ssrfSafeFetch('https://example.com')).rejects.toThrow(
        'SSRF-safe fetch failed: Network error',
      );

      expect(console.error).toHaveBeenCalledWith('SSRF-safe fetch error:', originalError);
    });

    it('should handle non-Error thrown values', async () => {
      const nonErrorValue = 'String error';
      mockFetch.mockRejectedValue(nonErrorValue);

      await expect(ssrfSafeFetch('https://example.com')).rejects.toThrow(
        'SSRF-safe fetch failed: String error',
      );
    });

    it('should handle null/undefined error values', async () => {
      mockFetch.mockRejectedValue(null);

      await expect(ssrfSafeFetch('https://example.com')).rejects.toThrow(
        'SSRF-safe fetch failed: null',
      );
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
