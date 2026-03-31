import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProxyDispatcherManager } from '../dispatcher';

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
  Agent: vi.fn(),
  ProxyAgent: vi.fn(),
  getGlobalDispatcher: vi.fn(),
  setGlobalDispatcher: vi.fn(),
}));

// Mock fetch-socks
vi.mock('fetch-socks', () => ({
  socksDispatcher: vi.fn(),
}));

// Mock ProxyUrlBuilder
vi.mock('../urlBuilder', () => ({
  ProxyUrlBuilder: {
    build: vi.fn(),
  },
}));

describe('ProxyDispatcherManager', () => {
  let mockDispatcher: any;
  let mockAgent: any;
  let mockProxyAgent: any;
  let mockGetGlobalDispatcher: any;
  let mockSetGlobalDispatcher: any;
  let mockSocksDispatcher: any;
  let mockProxyUrlBuilder: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import mocked modules
    const undici = await import('undici');
    const fetchSocks = await import('fetch-socks');
    const urlBuilder = await import('../urlBuilder');

    mockAgent = vi.mocked(undici.Agent);
    mockProxyAgent = vi.mocked(undici.ProxyAgent);
    mockGetGlobalDispatcher = vi.mocked(undici.getGlobalDispatcher);
    mockSetGlobalDispatcher = vi.mocked(undici.setGlobalDispatcher);
    mockSocksDispatcher = vi.mocked(fetchSocks.socksDispatcher);
    mockProxyUrlBuilder = vi.mocked(urlBuilder.ProxyUrlBuilder.build);

    // Setup mock dispatcher with destroy method
    mockDispatcher = {
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    mockGetGlobalDispatcher.mockReturnValue(mockDispatcher);
    mockAgent.mockReturnValue({ destroy: vi.fn().mockResolvedValue(undefined) });
    mockProxyAgent.mockReturnValue({ destroy: vi.fn().mockResolvedValue(undefined) });
    mockSocksDispatcher.mockReturnValue({ destroy: vi.fn().mockResolvedValue(undefined) });

    // Setup ProxyUrlBuilder mock to return properly formatted URLs
    mockProxyUrlBuilder.mockImplementation((config: NetworkProxySettings) => {
      if (config.proxyRequireAuth && config.proxyUsername && config.proxyPassword) {
        return `${config.proxyType}://${config.proxyUsername}:${config.proxyPassword}@${config.proxyServer}:${config.proxyPort}`;
      }
      return `${config.proxyType}://${config.proxyServer}:${config.proxyPort}`;
    });
  });

  describe('createProxyAgent', () => {
    describe('HTTP/HTTPS proxy', () => {
      it('should create ProxyAgent for http proxy', () => {
        const proxyUrl = 'http://proxy.example.com:8080';

        ProxyDispatcherManager.createProxyAgent('http', proxyUrl);

        expect(mockProxyAgent).toHaveBeenCalledWith({ uri: proxyUrl });
      });

      it('should create ProxyAgent for https proxy', () => {
        const proxyUrl = 'https://proxy.example.com:8080';

        ProxyDispatcherManager.createProxyAgent('https', proxyUrl);

        expect(mockProxyAgent).toHaveBeenCalledWith({ uri: proxyUrl });
      });

      it('should create ProxyAgent with authentication', () => {
        const proxyUrl = 'http://user:pass@proxy.example.com:8080';

        ProxyDispatcherManager.createProxyAgent('http', proxyUrl);

        expect(mockProxyAgent).toHaveBeenCalledWith({ uri: proxyUrl });
      });
    });

    describe('SOCKS5 proxy', () => {
      it('should create socksDispatcher for socks5 proxy without auth', () => {
        const proxyUrl = 'socks5://proxy.example.com:1080';

        ProxyDispatcherManager.createProxyAgent('socks5', proxyUrl);

        expect(mockSocksDispatcher).toHaveBeenCalledWith([
          {
            host: 'proxy.example.com',
            port: 1080,
            type: 5,
          },
        ]);
      });

      it('should create socksDispatcher for socks5 proxy with auth', () => {
        const proxyUrl = 'socks5://user:pass@proxy.example.com:1080';

        ProxyDispatcherManager.createProxyAgent('socks5', proxyUrl);

        expect(mockSocksDispatcher).toHaveBeenCalledWith([
          {
            host: 'proxy.example.com',
            port: 1080,
            type: 5,
            userId: 'user',
            password: 'pass',
          },
        ]);
      });

      it('should create socksDispatcher with IPv4 address', () => {
        const proxyUrl = 'socks5://192.168.1.1:1080';

        ProxyDispatcherManager.createProxyAgent('socks5', proxyUrl);

        expect(mockSocksDispatcher).toHaveBeenCalledWith([
          {
            host: '192.168.1.1',
            port: 1080,
            type: 5,
          },
        ]);
      });

      it('should create socksDispatcher with different port', () => {
        const proxyUrl = 'socks5://proxy.example.com:9050';

        ProxyDispatcherManager.createProxyAgent('socks5', proxyUrl);

        expect(mockSocksDispatcher).toHaveBeenCalledWith([
          {
            host: 'proxy.example.com',
            port: 9050,
            type: 5,
          },
        ]);
      });
    });

    describe('error handling', () => {
      it('should throw error when ProxyAgent creation fails', () => {
        mockProxyAgent.mockImplementationOnce(() => {
          throw new Error('ProxyAgent creation failed');
        });

        expect(() => {
          ProxyDispatcherManager.createProxyAgent('http', 'http://invalid');
        }).toThrow('Failed to create proxy agent: ProxyAgent creation failed');
      });

      it('should throw error when socksDispatcher creation fails', () => {
        mockSocksDispatcher.mockImplementationOnce(() => {
          throw new Error('SOCKS dispatcher creation failed');
        });

        expect(() => {
          ProxyDispatcherManager.createProxyAgent('socks5', 'socks5://invalid');
        }).toThrow('Failed to create proxy agent: SOCKS dispatcher creation failed');
      });

      it('should throw error with unknown error type', () => {
        mockProxyAgent.mockImplementationOnce(() => {
          throw 'String error';
        });

        expect(() => {
          ProxyDispatcherManager.createProxyAgent('http', 'http://invalid');
        }).toThrow('Failed to create proxy agent: Unknown error');
      });
    });
  });

  describe('applyProxySettings', () => {
    const validConfig: NetworkProxySettings = {
      enableProxy: true,
      proxyType: 'http',
      proxyServer: 'proxy.example.com',
      proxyPort: '8080',
      proxyRequireAuth: false,
      proxyBypass: 'localhost,127.0.0.1,::1',
    };

    describe('disable proxy', () => {
      it('should reset to direct connection when proxy is disabled', async () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          enableProxy: false,
        };

        await ProxyDispatcherManager.applyProxySettings(config);

        expect(mockDispatcher.destroy).toHaveBeenCalled();
        expect(mockAgent).toHaveBeenCalled();
        expect(mockSetGlobalDispatcher).toHaveBeenCalled();
      });

      it('should handle dispatcher destruction failure gracefully', async () => {
        mockDispatcher.destroy.mockRejectedValueOnce(new Error('Destroy failed'));

        const config: NetworkProxySettings = {
          ...validConfig,
          enableProxy: false,
        };

        // Should not throw even if destroy fails
        await expect(ProxyDispatcherManager.applyProxySettings(config)).resolves.not.toThrow();
      });

      it('should handle dispatcher without destroy method', async () => {
        mockGetGlobalDispatcher.mockReturnValueOnce({});

        const config: NetworkProxySettings = {
          ...validConfig,
          enableProxy: false,
        };

        await expect(ProxyDispatcherManager.applyProxySettings(config)).resolves.not.toThrow();
      });
    });

    describe('enable proxy', () => {
      it('should apply http proxy settings', async () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyType: 'http',
        };

        await ProxyDispatcherManager.applyProxySettings(config);

        expect(mockDispatcher.destroy).toHaveBeenCalled();
        expect(mockProxyAgent).toHaveBeenCalledWith({
          uri: 'http://proxy.example.com:8080',
        });
        expect(mockSetGlobalDispatcher).toHaveBeenCalled();
      });

      it('should apply https proxy settings', async () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyType: 'https',
        };

        await ProxyDispatcherManager.applyProxySettings(config);

        expect(mockProxyAgent).toHaveBeenCalledWith({
          uri: 'https://proxy.example.com:8080',
        });
      });

      it('should apply socks5 proxy settings', async () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyType: 'socks5',
        };

        await ProxyDispatcherManager.applyProxySettings(config);

        expect(mockSocksDispatcher).toHaveBeenCalled();
        expect(mockSetGlobalDispatcher).toHaveBeenCalled();
      });

      it('should apply proxy with authentication', async () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyRequireAuth: true,
          proxyUsername: 'testuser',
          proxyPassword: 'testpass',
        };

        await ProxyDispatcherManager.applyProxySettings(config);

        expect(mockProxyAgent).toHaveBeenCalledWith({
          uri: 'http://testuser:testpass@proxy.example.com:8080',
        });
      });

      it('should destroy old dispatcher before applying new proxy', async () => {
        const destroySpy = vi.fn().mockResolvedValue(undefined);
        mockGetGlobalDispatcher.mockReturnValue({ destroy: destroySpy });

        await ProxyDispatcherManager.applyProxySettings(validConfig);

        expect(destroySpy).toHaveBeenCalled();
        expect(mockSetGlobalDispatcher).toHaveBeenCalled();
      });
    });

    describe('concurrent proxy changes', () => {
      it('should queue concurrent proxy setting changes', async () => {
        const config1: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '8080',
        };

        const config2: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '8081',
        };

        // Start both operations concurrently
        const promise1 = ProxyDispatcherManager.applyProxySettings(config1);
        const promise2 = ProxyDispatcherManager.applyProxySettings(config2);

        await Promise.all([promise1, promise2]);

        // Both operations should complete successfully
        expect(mockSetGlobalDispatcher).toHaveBeenCalled();
      });

      it('should process queued operations sequentially', async () => {
        const operations: Promise<void>[] = [];

        // Queue multiple operations
        for (let i = 0; i < 5; i++) {
          const config: NetworkProxySettings = {
            ...validConfig,
            proxyPort: `${8080 + i}`,
          };
          operations.push(ProxyDispatcherManager.applyProxySettings(config));
        }

        await Promise.all(operations);

        // All operations should complete
        expect(mockSetGlobalDispatcher).toHaveBeenCalledTimes(5);
      });

      it('should handle errors in queued operations', async () => {
        mockProxyAgent.mockReturnValueOnce({ destroy: vi.fn() }).mockImplementationOnce(() => {
          throw new Error('Agent creation failed');
        });

        const config1: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '8080',
        };

        const config2: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '8081',
        };

        const promise1 = ProxyDispatcherManager.applyProxySettings(config1);
        const promise2 = ProxyDispatcherManager.applyProxySettings(config2);

        await expect(promise1).resolves.not.toThrow();
        await expect(promise2).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('should propagate error when agent creation fails', async () => {
        mockProxyAgent.mockImplementationOnce(() => {
          throw new Error('Agent creation failed');
        });

        await expect(ProxyDispatcherManager.applyProxySettings(validConfig)).rejects.toThrow(
          'Failed to create proxy agent',
        );
      });

      it('should handle null dispatcher gracefully', async () => {
        mockGetGlobalDispatcher.mockReturnValueOnce(null);

        await expect(ProxyDispatcherManager.applyProxySettings(validConfig)).resolves.not.toThrow();
      });

      it('should handle undefined dispatcher gracefully', async () => {
        mockGetGlobalDispatcher.mockReturnValueOnce(undefined);

        await expect(ProxyDispatcherManager.applyProxySettings(validConfig)).resolves.not.toThrow();
      });
    });
  });
});
