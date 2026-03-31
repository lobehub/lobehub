import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProxyConnectionTester } from '../tester';

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock undici
vi.mock('undici', () => ({
  fetch: vi.fn(),
  getGlobalDispatcher: vi.fn(),
  setGlobalDispatcher: vi.fn(),
}));

// Mock ProxyConfigValidator
vi.mock('../validator', () => ({
  ProxyConfigValidator: {
    validate: vi.fn(),
  },
}));

// Mock ProxyUrlBuilder
vi.mock('../urlBuilder', () => ({
  ProxyUrlBuilder: {
    build: vi.fn(),
  },
}));

// Mock ProxyDispatcherManager
vi.mock('../dispatcher', () => ({
  ProxyDispatcherManager: {
    createProxyAgent: vi.fn(),
  },
}));

describe('ProxyConnectionTester', () => {
  let mockAgent: any;
  let mockOriginalDispatcher: any;
  let mockFetch: any;
  let mockGetGlobalDispatcher: any;
  let mockSetGlobalDispatcher: any;
  let mockProxyDispatcherManager: any;
  let mockProxyConfigValidator: any;
  let mockProxyUrlBuilder: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import mocked modules
    const undici = await import('undici');
    const dispatcher = await import('../dispatcher');
    const validator = await import('../validator');
    const urlBuilder = await import('../urlBuilder');

    mockFetch = vi.mocked(undici.fetch);
    mockGetGlobalDispatcher = vi.mocked(undici.getGlobalDispatcher);
    mockSetGlobalDispatcher = vi.mocked(undici.setGlobalDispatcher);
    mockProxyDispatcherManager = vi.mocked(dispatcher.ProxyDispatcherManager);
    mockProxyConfigValidator = vi.mocked(validator.ProxyConfigValidator);
    mockProxyUrlBuilder = vi.mocked(urlBuilder.ProxyUrlBuilder.build);

    // Setup mock agent
    mockAgent = {
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    mockOriginalDispatcher = {
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    mockGetGlobalDispatcher.mockReturnValue(mockOriginalDispatcher);
    mockProxyDispatcherManager.createProxyAgent.mockReturnValue(mockAgent);
    mockProxyConfigValidator.validate.mockReturnValue({ isValid: true, errors: [] });
    mockProxyUrlBuilder.mockImplementation((config: NetworkProxySettings) => {
      return `${config.proxyType}://${config.proxyServer}:${config.proxyPort}`;
    });
  });

  describe('testConnection', () => {
    describe('successful connection', () => {
      it('should return success for successful HTTP request', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const result = await ProxyConnectionTester.testConnection();

        expect(result.success).toBe(true);
        expect(result.responseTime).toBeGreaterThanOrEqual(0);
        expect(result.message).toBeUndefined();
        expect(mockFetch).toHaveBeenCalledWith(
          'https://www.google.com',
          expect.objectContaining({
            headers: expect.objectContaining({
              'User-Agent': 'LobeChat-Desktop/1.0.0',
            }),
            signal: expect.any(AbortSignal),
          }),
        );
      });

      it('should return success with custom URL', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const customUrl = 'https://api.example.com';
        const result = await ProxyConnectionTester.testConnection(customUrl);

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(customUrl, expect.any(Object));
      });

      it('should return success with custom timeout', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const result = await ProxyConnectionTester.testConnection('https://www.google.com', 5000);

        expect(result.success).toBe(true);
      });

      it('should include response time in result', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const result = await ProxyConnectionTester.testConnection();

        expect(result.responseTime).toBeDefined();
        expect(typeof result.responseTime).toBe('number');
        expect(result.responseTime).toBeGreaterThanOrEqual(0);
      });
    });

    describe('connection failures', () => {
      it('should return failure for HTTP error status', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        });

        const result = await ProxyConnectionTester.testConnection();

        expect(result.success).toBe(false);
        expect(result.message).toContain('HTTP 404');
        expect(result.message).toContain('Not Found');
        expect(result.responseTime).toBeGreaterThanOrEqual(0);
      });

      it('should return failure for HTTP 500 error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        const result = await ProxyConnectionTester.testConnection();

        expect(result.success).toBe(false);
        expect(result.message).toContain('HTTP 500');
      });

      it('should return failure for network error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await ProxyConnectionTester.testConnection();

        expect(result.success).toBe(false);
        expect(result.message).toBe('Network error');
        expect(result.responseTime).toBeGreaterThanOrEqual(0);
      });

      it('should return failure for timeout', async () => {
        mockFetch.mockImplementationOnce(() => {
          return new Promise((_, reject) => {
            const error = new Error('Request aborted');
            error.name = 'AbortError';
            setTimeout(() => reject(error), 50);
          });
        });

        const result = await ProxyConnectionTester.testConnection('https://www.google.com', 100);

        expect(result.success).toBe(false);
        expect(result.message).toBeTruthy();
      });

      it('should return failure for connection refused', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const result = await ProxyConnectionTester.testConnection();

        expect(result.success).toBe(false);
        expect(result.message).toBe('ECONNREFUSED');
      });

      it('should handle unknown error type', async () => {
        mockFetch.mockRejectedValueOnce('String error');

        const result = await ProxyConnectionTester.testConnection();

        expect(result.success).toBe(false);
        expect(result.message).toBe('Unknown error');
      });
    });
  });

  describe('testProxyConfig', () => {
    const validConfig: NetworkProxySettings = {
      enableProxy: true,
      proxyType: 'http',
      proxyServer: 'proxy.example.com',
      proxyPort: '8080',
      proxyRequireAuth: false,
      proxyBypass: 'localhost,127.0.0.1,::1',
    };

    describe('config validation', () => {
      it('should return failure for invalid config', async () => {
        mockProxyConfigValidator.validate.mockReturnValueOnce({
          isValid: false,
          errors: ['Proxy server is required', 'Invalid port'],
        });

        const result = await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid proxy configuration');
        expect(result.message).toContain('Proxy server is required');
        expect(result.message).toContain('Invalid port');
      });

      it('should validate config before testing', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(mockProxyConfigValidator.validate).toHaveBeenCalledWith(validConfig);
      });
    });

    describe('disabled proxy', () => {
      it('should test direct connection when proxy is disabled', async () => {
        const disabledConfig: NetworkProxySettings = {
          ...validConfig,
          enableProxy: false,
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const result = await ProxyConnectionTester.testProxyConfig(disabledConfig);

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalled();
      });

      it('should use custom test URL for disabled proxy', async () => {
        const disabledConfig: NetworkProxySettings = {
          ...validConfig,
          enableProxy: false,
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const customUrl = 'https://api.example.com';
        await ProxyConnectionTester.testProxyConfig(disabledConfig, customUrl);

        expect(mockFetch).toHaveBeenCalledWith(customUrl, expect.any(Object));
      });
    });

    describe('enabled proxy', () => {
      it('should test proxy connection successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const result = await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(result.success).toBe(true);
        expect(result.responseTime).toBeGreaterThanOrEqual(0);
      });

      it('should create temporary proxy agent for testing', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(mockProxyDispatcherManager.createProxyAgent).toHaveBeenCalledWith(
          'http',
          'http://proxy.example.com:8080',
        );
      });

      it('should restore original dispatcher after test', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(mockSetGlobalDispatcher).toHaveBeenCalledWith(mockOriginalDispatcher);
      });

      it('should destroy temporary agent after test', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(mockAgent.destroy).toHaveBeenCalled();
      });

      it('should restore dispatcher even if test fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Connection failed'));

        await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(mockSetGlobalDispatcher).toHaveBeenCalledWith(mockOriginalDispatcher);
      });

      it('should destroy agent even if test fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Connection failed'));

        await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(mockAgent.destroy).toHaveBeenCalled();
      });

      it('should handle agent destroy failure gracefully', async () => {
        mockAgent.destroy.mockRejectedValueOnce(new Error('Destroy failed'));
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const result = await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(result.success).toBe(true);
      });

      it('should test with custom URL', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const customUrl = 'https://httpbin.org/ip';
        await ProxyConnectionTester.testProxyConfig(validConfig, customUrl);

        expect(mockFetch).toHaveBeenCalledWith(
          customUrl,
          expect.objectContaining({
            dispatcher: mockAgent,
          }),
        );
      });

      it('should test socks5 proxy', async () => {
        const socks5Config: NetworkProxySettings = {
          ...validConfig,
          proxyType: 'socks5',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        await ProxyConnectionTester.testProxyConfig(socks5Config);

        expect(mockProxyDispatcherManager.createProxyAgent).toHaveBeenCalledWith(
          'socks5',
          expect.any(String),
        );
      });

      it('should test proxy with authentication', async () => {
        const authConfig: NetworkProxySettings = {
          ...validConfig,
          proxyRequireAuth: true,
          proxyUsername: 'user',
          proxyPassword: 'pass',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        await ProxyConnectionTester.testProxyConfig(authConfig);

        expect(mockProxyUrlBuilder).toHaveBeenCalledWith(authConfig);
      });
    });

    describe('error handling', () => {
      it('should return failure when agent creation fails', async () => {
        mockProxyDispatcherManager.createProxyAgent.mockImplementationOnce(() => {
          throw new Error('Agent creation failed');
        });

        const result = await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Proxy test failed');
        expect(result.message).toContain('Agent creation failed');
      });

      it('should return failure when fetch fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Connection timeout'));

        const result = await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Connection timeout');
      });

      it('should return failure for HTTP error response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 407,
          statusText: 'Proxy Authentication Required',
        });

        const result = await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('HTTP 407');
      });

      it('should handle timeout correctly', async () => {
        mockFetch.mockImplementationOnce(() => {
          return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 50);
          });
        });

        const result = await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(result.success).toBe(false);
      });

      it('should handle unknown error type', async () => {
        mockProxyDispatcherManager.createProxyAgent.mockImplementationOnce(() => {
          throw 'String error';
        });

        const result = await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Unknown error');
      });

      it('should handle null agent', async () => {
        mockProxyDispatcherManager.createProxyAgent.mockReturnValueOnce(null);

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const result = await ProxyConnectionTester.testProxyConfig(validConfig);

        // Should handle gracefully
        expect(result).toBeDefined();
      });

      it('should handle agent without destroy method', async () => {
        mockProxyDispatcherManager.createProxyAgent.mockReturnValueOnce({});

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

        const result = await ProxyConnectionTester.testProxyConfig(validConfig);

        expect(result.success).toBe(true);
      });
    });
  });
});
