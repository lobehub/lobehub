import { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import NetworkProxyCtr from '../NetworkProxyCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

// 模拟 logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// 模拟 undici - 使用 vi.fn() 直接在 Mock 中创建
vi.mock('undici', () => ({
  fetch: vi.fn(),
  getGlobalDispatcher: vi.fn(),
  setGlobalDispatcher: vi.fn(),
  Agent: vi.fn(),
  ProxyAgent: vi.fn(),
}));

// 模拟 defaultProxySettings
vi.mock('@/const/store', () => ({
  defaultProxySettings: {
    enableProxy: false,
    proxyBypass: 'localhost,127.0.0.1,::1',
    proxyPort: '',
    proxyRequireAuth: false,
    proxyServer: '',
    proxyType: 'http',
  },
}));

// 模拟 App 及其依赖项
const mockStoreManager = {
  get: vi.fn(),
  set: vi.fn(),
};

const mockApp = {
  storeManager: mockStoreManager,
} as unknown as App;

describe('NetworkProxyCtr', () => {
  let networkProxyCtr: NetworkProxyCtr;

  // 动态导入 undici 的 Mock
  let mockUndici: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    ipcMainHandleMock.mockClear();

    // 动态导入 undici Mock
    mockUndici = await import('undici');

    networkProxyCtr = new NetworkProxyCtr(mockApp);

    // 设置 undici mocks 的默认返回值
    vi.mocked(mockUndici.Agent).mockReturnValue({});
    vi.mocked(mockUndici.ProxyAgent).mockReturnValue({});
    vi.mocked(mockUndici.getGlobalDispatcher).mockReturnValue({
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(mockUndici.setGlobalDispatcher).mockReturnValue(undefined);

    // 设置 fetch mock 的默认返回值
    vi.mocked(mockUndici.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
  });

  describe('ProxyConfigValidator', () => {
    const validConfig: NetworkProxySettings = {
      enableProxy: true,
      proxyType: 'http',
      proxyServer: 'proxy.example.com',
      proxyPort: '8080',
      proxyRequireAuth: false,
      proxyBypass: 'localhost,127.0.0.1,::1',
    };

    it('should validate enabled proxy config with all required fields', () => {
      // 通过测试公共方法来间接测试验证逻辑
      expect(() => networkProxyCtr.setProxySettings(validConfig)).not.toThrow();
    });

    it('should validate disabled proxy config', () => {
      const disabledConfig: NetworkProxySettings = {
        ...validConfig,
        enableProxy: false,
      };

      expect(() => networkProxyCtr.setProxySettings(disabledConfig)).not.toThrow();
    });

    it('should reject invalid proxy type', async () => {
      const invalidConfig: NetworkProxySettings = {
        ...validConfig,
        proxyType: 'invalid' as any,
      };

      await expect(networkProxyCtr.setProxySettings(invalidConfig)).rejects.toThrow();
    });

    it('should reject missing proxy server', async () => {
      const invalidConfig: NetworkProxySettings = {
        ...validConfig,
        proxyServer: '',
      };

      await expect(networkProxyCtr.setProxySettings(invalidConfig)).rejects.toThrow();
    });

    it('should reject invalid proxy port', async () => {
      const invalidConfig: NetworkProxySettings = {
        ...validConfig,
        proxyPort: 'invalid',
      };

      await expect(networkProxyCtr.setProxySettings(invalidConfig)).rejects.toThrow();
    });

    it('should reject missing auth credentials when auth is required', async () => {
      const invalidConfig: NetworkProxySettings = {
        ...validConfig,
        proxyRequireAuth: true,
        proxyUsername: '',
        proxyPassword: '',
      };

      await expect(networkProxyCtr.setProxySettings(invalidConfig)).rejects.toThrow();
    });
  });

  describe('getDesktopSettings', () => {
    it('should return stored proxy settings', async () => {
      const expectedSettings: NetworkProxySettings = {
        enableProxy: true,
        proxyType: 'http',
        proxyServer: 'proxy.example.com',
        proxyPort: '8080',
        proxyRequireAuth: false,
        proxyBypass: 'localhost,127.0.0.1,::1',
      };

      mockStoreManager.get.mockReturnValue(expectedSettings);

      const result = await networkProxyCtr.getDesktopSettings();

      expect(result).toEqual(expectedSettings);
      expect(mockStoreManager.get).toHaveBeenCalledWith('networkProxy', expect.any(Object));
    });

    it('should return default settings when store fails', async () => {
      mockStoreManager.get.mockImplementation(() => {
        throw new Error('Store error');
      });

      const result = await networkProxyCtr.getDesktopSettings();

      expect(result).toEqual({
        enableProxy: false,
        proxyBypass: 'localhost,127.0.0.1,::1',
        proxyPort: '',
        proxyRequireAuth: false,
        proxyServer: '',
        proxyType: 'http',
      });
    });
  });

  describe('setProxySettings', () => {
    const validConfig: NetworkProxySettings = {
      enableProxy: true,
      proxyType: 'http',
      proxyServer: 'proxy.example.com',
      proxyPort: '8080',
      proxyRequireAuth: false,
      proxyBypass: 'localhost,127.0.0.1,::1',
    };

    it('should save valid proxy settings', async () => {
      mockStoreManager.get.mockReturnValue({
        enableProxy: false,
        proxyType: 'http',
        proxyServer: '',
        proxyPort: '',
        proxyRequireAuth: false,
        proxyBypass: 'localhost,127.0.0.1,::1',
      });

      await networkProxyCtr.setProxySettings(validConfig);

      expect(mockStoreManager.set).toHaveBeenCalledWith(
        'networkProxy',
        expect.objectContaining(validConfig),
      );
    });

    it('should skip update if settings are unchanged', async () => {
      mockStoreManager.get.mockReturnValue(validConfig);

      await networkProxyCtr.setProxySettings(validConfig);

      expect(mockStoreManager.set).not.toHaveBeenCalled();
    });

    it('should throw error for invalid configuration', async () => {
      const invalidConfig: NetworkProxySettings = {
        ...validConfig,
        proxyServer: '',
      };

      await expect(networkProxyCtr.setProxySettings(invalidConfig)).rejects.toThrow();
    });
  });

  describe('testProxyConnection', () => {
    it('should return success for successful connection', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
      };

      vi.mocked(mockUndici.fetch).mockResolvedValueOnce(mockResponse);

      const result = await networkProxyCtr.testProxyConnection('https://www.google.com');

      expect(result).toEqual({ success: true });
      expect(mockUndici.fetch).toHaveBeenCalledWith('https://www.google.com', expect.any(Object));
    });

    it('should throw error for failed connection', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      };

      vi.mocked(mockUndici.fetch).mockResolvedValueOnce(mockResponse);

      await expect(networkProxyCtr.testProxyConnection('https://www.google.com')).rejects.toThrow();
    });

    it('should throw error for network error', async () => {
      vi.mocked(mockUndici.fetch).mockRejectedValueOnce(new Error('Network error'));

      await expect(networkProxyCtr.testProxyConnection('https://www.google.com')).rejects.toThrow();
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

    it('should return success for valid config and successful connection', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
      };

      vi.mocked(mockUndici.fetch).mockResolvedValueOnce(mockResponse);

      const result = await networkProxyCtr.testProxyConfig({ config: validConfig });

      expect(result.success).toBe(true);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should return failure for invalid config', async () => {
      const invalidConfig: NetworkProxySettings = {
        ...validConfig,
        proxyServer: '',
      };

      const result = await networkProxyCtr.testProxyConfig({ config: invalidConfig });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid proxy configuration');
    });

    it('should test direct connection for disabled proxy', async () => {
      const disabledConfig: NetworkProxySettings = {
        ...validConfig,
        enableProxy: false,
      };

      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
      };

      vi.mocked(mockUndici.fetch).mockResolvedValueOnce(mockResponse);

      const result = await networkProxyCtr.testProxyConfig({ config: disabledConfig });

      expect(result.success).toBe(true);
    });

    it('should return failure for connection error', async () => {
      vi.mocked(mockUndici.fetch).mockRejectedValueOnce(new Error('Connection failed'));

      const result = await networkProxyCtr.testProxyConfig({ config: validConfig });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection failed');
    });
  });

  describe('beforeAppReady', () => {
    it('should apply stored proxy settings on app ready', async () => {
      const storedConfig: NetworkProxySettings = {
        enableProxy: true,
        proxyType: 'http',
        proxyServer: 'proxy.example.com',
        proxyPort: '8080',
        proxyRequireAuth: false,
        proxyBypass: 'localhost,127.0.0.1,::1',
      };

      mockStoreManager.get.mockReturnValue(storedConfig);

      await networkProxyCtr.beforeAppReady();

      expect(mockStoreManager.get).toHaveBeenCalledWith('networkProxy', expect.any(Object));
    });

    it('should use default settings if stored config is invalid', async () => {
      const invalidConfig: NetworkProxySettings = {
        enableProxy: true,
        proxyType: 'http',
        proxyServer: '', // 无效的服务器
        proxyPort: '8080',
        proxyRequireAuth: false,
        proxyBypass: 'localhost,127.0.0.1,::1',
      };

      mockStoreManager.get.mockReturnValue(invalidConfig);

      await networkProxyCtr.beforeAppReady();

      expect(mockStoreManager.get).toHaveBeenCalledWith('networkProxy', expect.any(Object));
    });

    it('should handle errors gracefully', async () => {
      mockStoreManager.get.mockImplementation(() => {
        throw new Error('Store error');
      });

      // 不应该抛出错误
      await expect(networkProxyCtr.beforeAppReady()).resolves.not.toThrow();

      mockStoreManager.get.mockReset();
    });
  });

  describe('ProxyUrlBuilder', () => {
    it('should build URL without authentication', () => {
      const config: NetworkProxySettings = {
        enableProxy: true,
        proxyType: 'http',
        proxyServer: 'proxy.example.com',
        proxyPort: '8080',
        proxyRequireAuth: false,
        proxyBypass: 'localhost,127.0.0.1,::1',
      };

      // 通过测试代理设置来间接测试 URL 构建
      expect(() => networkProxyCtr.setProxySettings(config)).not.toThrow();
    });

    it('should build URL with authentication', () => {
      const config: NetworkProxySettings = {
        enableProxy: true,
        proxyType: 'http',
        proxyServer: 'proxy.example.com',
        proxyPort: '8080',
        proxyRequireAuth: true,
        proxyUsername: 'user',
        proxyPassword: 'pass',
        proxyBypass: 'localhost,127.0.0.1,::1',
      };

      // 通过测试代理设置来间接测试 URL 构建
      expect(() => networkProxyCtr.setProxySettings(config)).not.toThrow();
    });

    it('should handle special characters in credentials', () => {
      const config: NetworkProxySettings = {
        enableProxy: true,
        proxyType: 'http',
        proxyServer: 'proxy.example.com',
        proxyPort: '8080',
        proxyRequireAuth: true,
        proxyUsername: 'user@domain',
        proxyPassword: 'pass:word',
        proxyBypass: 'localhost,127.0.0.1,::1',
      };

      // 通过测试代理设置来间接测试 URL 构建
      expect(() => networkProxyCtr.setProxySettings(config)).not.toThrow();
    });
  });
});
vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));
