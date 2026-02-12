import { DataSyncConfig } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import RemoteServerConfigCtr from '../RemoteServerConfigCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
  safeStorage: {
    decryptString: vi.fn((buffer: Buffer) => buffer.toString()),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    isEncryptionAvailable: vi.fn(() => true),
  },
}));

// Mock @/const/env
vi.mock('@/const/env', () => ({
  OFFICIAL_CLOUD_SERVER: 'https://cloud.lobehub.com',
}));

// Mock storeManager
const mockStoreManager = {
  delete: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
};

const mockBrowserManager = {
  broadcastToAllWindows: vi.fn(),
};

const mockApp = {
  browserManager: mockBrowserManager,
  storeManager: mockStoreManager,
} as unknown as App;

describe('RemoteServerConfigCtr', () => {
  let controller: RemoteServerConfigCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMainHandleMock.mockClear();
    mockStoreManager.get.mockReturnValue({
      active: false,
      storageMode: 'cloud',
    });
    controller = new RemoteServerConfigCtr(mockApp);
  });

  describe('getRemoteServerConfig', () => {
    it('should return stored configuration', async () => {
      const config: DataSyncConfig = {
        active: true,
        remoteServerUrl: 'https://my-server.com',
        storageMode: 'selfHost',
      };
      mockStoreManager.get.mockReturnValue(config);

      const result = await controller.getRemoteServerConfig();

      expect(result).toEqual(config);
      expect(mockStoreManager.get).toHaveBeenCalledWith('dataSyncConfig');
    });
  });

  describe('setRemoteServerConfig', () => {
    it('should update configuration', async () => {
      const prevConfig: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };
      mockStoreManager.get.mockReturnValue(prevConfig);

      const newConfig: Partial<DataSyncConfig> = {
        active: true,
        remoteServerUrl: 'https://my-server.com',
        storageMode: 'selfHost',
      };

      const result = await controller.setRemoteServerConfig(newConfig);

      expect(result).toBe(true);
      expect(mockStoreManager.set).toHaveBeenCalledWith('dataSyncConfig', {
        ...prevConfig,
        ...newConfig,
      });
    });
  });

  describe('clearRemoteServerConfig', () => {
    it('should clear configuration and tokens', async () => {
      const result = await controller.clearRemoteServerConfig();

      expect(result).toBe(true);
      expect(mockStoreManager.set).toHaveBeenCalledWith('dataSyncConfig', {
        active: false,
        storageMode: 'cloud',
      });
      expect(mockStoreManager.delete).toHaveBeenCalledWith('encryptedTokens');
    });
  });

  describe('saveTokens', () => {
    it('should save encrypted tokens with expiration', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      await controller.saveTokens('access-token', 'refresh-token', 3600);

      expect(safeStorage.encryptString).toHaveBeenCalledWith('access-token');
      expect(safeStorage.encryptString).toHaveBeenCalledWith('refresh-token');
      expect(mockStoreManager.set).toHaveBeenCalledWith(
        'encryptedTokens',
        expect.objectContaining({
          accessToken: expect.any(String),
          expiresAt: expect.any(Number),
          refreshToken: expect.any(String),
        }),
      );
    });

    it('should save tokens without expiration', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      await controller.saveTokens('access-token', 'refresh-token');

      expect(mockStoreManager.set).toHaveBeenCalledWith(
        'encryptedTokens',
        expect.objectContaining({
          accessToken: expect.any(String),
          expiresAt: undefined,
          refreshToken: expect.any(String),
        }),
      );
    });

    it('should save unencrypted tokens when encryption is not available', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      await controller.saveTokens('access-token', 'refresh-token', 3600);

      expect(safeStorage.encryptString).not.toHaveBeenCalled();
      expect(mockStoreManager.set).toHaveBeenCalledWith(
        'encryptedTokens',
        expect.objectContaining({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        }),
      );
    });
  });

  describe('getAccessToken', () => {
    it('should return decrypted access token', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      // First save a token
      await controller.saveTokens('test-access-token', 'test-refresh-token');

      const result = await controller.getAccessToken();

      expect(result).toBe('test-access-token');
    });

    it('should load token from store if not in memory', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockReturnValue('stored-access-token');

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'encryptedTokens') {
          return {
            accessToken: Buffer.from('stored-access-token').toString('base64'),
            refreshToken: Buffer.from('stored-refresh-token').toString('base64'),
          };
        }
        return { active: false, storageMode: 'cloud' };
      });

      // Create new controller to test loading from store
      const newController = new RemoteServerConfigCtr(mockApp);
      const result = await newController.getAccessToken();

      expect(result).toBe('stored-access-token');
    });

    it('should return null when no token exists', async () => {
      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'encryptedTokens') {
          return null;
        }
        return { active: false, storageMode: 'cloud' };
      });

      const newController = new RemoteServerConfigCtr(mockApp);
      const result = await newController.getAccessToken();

      expect(result).toBeNull();
    });

    it('should return raw token when encryption is not available', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      await controller.saveTokens('raw-access-token', 'raw-refresh-token');
      const result = await controller.getAccessToken();

      expect(result).toBe('raw-access-token');
    });

    it('should return null on decryption error', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'encryptedTokens') {
          return {
            accessToken: 'invalid-encrypted-token',
            refreshToken: 'invalid-encrypted-token',
          };
        }
        return { active: false, storageMode: 'cloud' };
      });

      const newController = new RemoteServerConfigCtr(mockApp);
      const result = await newController.getAccessToken();

      expect(result).toBeNull();
    });
  });

  describe('getRefreshToken', () => {
    it('should return decrypted refresh token', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      await controller.saveTokens('test-access-token', 'test-refresh-token');

      const result = await controller.getRefreshToken();

      expect(result).toBe('test-refresh-token');
    });

    it('should return null when no token exists', async () => {
      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'encryptedTokens') {
          return null;
        }
        return { active: false, storageMode: 'cloud' };
      });

      const newController = new RemoteServerConfigCtr(mockApp);
      const result = await newController.getRefreshToken();

      expect(result).toBeNull();
    });
  });

  describe('clearTokens', () => {
    it('should clear all tokens from memory and store', async () => {
      await controller.saveTokens('access', 'refresh', 3600);
      await controller.clearTokens();

      expect(mockStoreManager.delete).toHaveBeenCalledWith('encryptedTokens');

      // Verify tokens are cleared from memory
      const accessToken = await controller.getAccessToken();
      expect(accessToken).toBeNull();
    });
  });

  describe('getTokenExpiresAt', () => {
    it('should return expiration time after saving tokens with expiration', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      const beforeSave = Date.now();
      await controller.saveTokens('access', 'refresh', 3600);
      const afterSave = Date.now();

      const expiresAt = controller.getTokenExpiresAt();

      expect(expiresAt).toBeDefined();
      expect(expiresAt).toBeGreaterThanOrEqual(beforeSave + 3600 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(afterSave + 3600 * 1000);
    });

    it('should return undefined when no expiration is set', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      await controller.saveTokens('access', 'refresh');

      const expiresAt = controller.getTokenExpiresAt();

      expect(expiresAt).toBeUndefined();
    });
  });

  describe('isTokenExpiringSoon', () => {
    it('should return false when no expiration is set', () => {
      const result = controller.isTokenExpiringSoon();

      expect(result).toBe(false);
    });

    it('should return false when token is not expiring soon', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      // Token expires in 2 days (well beyond the 24-hour default buffer)
      await controller.saveTokens('access', 'refresh', 2 * 24 * 3600);

      // Default buffer is 24 hours
      const result = controller.isTokenExpiringSoon();

      expect(result).toBe(false);
    });

    it('should return true when token is within buffer time', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      // Token expires in 2 minutes
      await controller.saveTokens('access', 'refresh', 120);

      // Default buffer is 5 minutes, so token is expiring soon
      const result = controller.isTokenExpiringSoon();

      expect(result).toBe(true);
    });

    it('should respect custom buffer time', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      // Token expires in 10 minutes
      await controller.saveTokens('access', 'refresh', 600);

      // With 15 minute buffer, should be expiring soon
      const result = controller.isTokenExpiringSoon(15 * 60 * 1000);

      expect(result).toBe(true);
    });
  });

  describe('isNonRetryableError', () => {
    it('should return false for null/undefined error', () => {
      expect(controller.isNonRetryableError(undefined)).toBe(false);
      expect(controller.isNonRetryableError('')).toBe(false);
    });

    it('should return true for OIDC error codes', () => {
      expect(controller.isNonRetryableError('invalid_grant')).toBe(true);
      expect(controller.isNonRetryableError('Token refresh failed: invalid_client')).toBe(true);
      expect(controller.isNonRetryableError('unauthorized_client error')).toBe(true);
      expect(controller.isNonRetryableError('access_denied by user')).toBe(true);
      expect(controller.isNonRetryableError('invalid_scope requested')).toBe(true);
    });

    it('should return true for deterministic failures', () => {
      expect(controller.isNonRetryableError('No refresh token available')).toBe(true);
      expect(controller.isNonRetryableError('Remote server is not active or configured')).toBe(
        true,
      );
      expect(controller.isNonRetryableError('Missing tokens in refresh response')).toBe(true);
    });

    it('should return false for transient/network errors', () => {
      expect(controller.isNonRetryableError('Network error')).toBe(false);
      expect(controller.isNonRetryableError('fetch failed')).toBe(false);
      expect(controller.isNonRetryableError('ETIMEDOUT')).toBe(false);
      expect(controller.isNonRetryableError('Connection refused')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(controller.isNonRetryableError('INVALID_GRANT')).toBe(true);
      expect(controller.isNonRetryableError('NO REFRESH TOKEN AVAILABLE')).toBe(true);
    });
  });

  describe('refreshAccessToken', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    it('should return error when remote server is not active', async () => {
      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return { active: false, storageMode: 'cloud' };
        }
        return null;
      });

      const result = await controller.refreshAccessToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not active');
    });

    it('should return error when no refresh token available', async () => {
      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        if (key === 'encryptedTokens') {
          return null;
        }
        return null;
      });

      const newController = new RemoteServerConfigCtr(mockApp);
      const result = await newController.refreshAccessToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('No refresh token');
    });

    it('should refresh token successfully', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        return null;
      });

      // Save initial tokens
      await controller.saveTokens('old-access', 'old-refresh');

      mockFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            expires_in: 3600,
            refresh_token: 'new-refresh-token',
          }),
        ok: true,
      });

      const result = await controller.refreshAccessToken();

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://server.com/oidc/token',
        expect.objectContaining({
          body: expect.stringContaining('grant_type=refresh_token'),
          method: 'POST',
        }),
      );
    });

    it('should handle refresh failure', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        return null;
      });

      await controller.saveTokens('old-access', 'old-refresh');

      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ error: 'invalid_grant' }),
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      const result = await controller.refreshAccessToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token refresh failed');
    });

    it('should handle missing tokens in response', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        return null;
      });

      await controller.saveTokens('old-access', 'old-refresh');

      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({}), // Missing tokens
        ok: true,
      });

      const result = await controller.refreshAccessToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing tokens');
    });

    it('should handle concurrent refresh requests by returning same result', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        return null;
      });

      await controller.saveTokens('old-access', 'old-refresh');

      let resolvePromise: (value: any) => void;
      const delayedResponse = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockFetch.mockReturnValue(delayedResponse);

      // Start two concurrent refresh requests
      const promise1 = controller.refreshAccessToken();
      const promise2 = controller.refreshAccessToken();

      // Resolve the fetch
      resolvePromise!({
        json: () =>
          Promise.resolve({
            access_token: 'new-access',
            expires_in: 3600,
            refresh_token: 'new-refresh',
          }),
        ok: true,
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Both results should be equal (same success)
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle network errors with retry', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        return null;
      });

      await controller.saveTokens('old-access', 'old-refresh');

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await controller.refreshAccessToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      // With retry mechanism, fetch should be called 4 times (1 initial + 3 retries)
      expect(mockFetch).toHaveBeenCalledTimes(4);
    }, 15000);
  });

  describe('afterAppReady', () => {
    it('should load tokens from store', () => {
      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'encryptedTokens') {
          return {
            accessToken: 'stored-access',
            expiresAt: Date.now() + 3600000,
            refreshToken: 'stored-refresh',
          };
        }
        return { active: false, storageMode: 'cloud' };
      });

      const newController = new RemoteServerConfigCtr(mockApp);
      newController.afterAppReady();

      // Verify tokens were loaded by checking getTokenExpiresAt
      expect(newController.getTokenExpiresAt()).toBeDefined();
    });

    it('should load lastRefreshAt from store', () => {
      const lastRefreshTime = Date.now() - 3600000; // 1 hour ago
      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'encryptedTokens') {
          return {
            accessToken: 'stored-access',
            expiresAt: Date.now() + 3600000,
            lastRefreshAt: lastRefreshTime,
            refreshToken: 'stored-refresh',
          };
        }
        return { active: false, storageMode: 'cloud' };
      });

      const newController = new RemoteServerConfigCtr(mockApp);
      newController.afterAppReady();

      // Verify lastRefreshAt was loaded
      expect(newController.getLastTokenRefreshAt()).toBe(lastRefreshTime);
    });
  });

  describe('getLastTokenRefreshAt', () => {
    it('should return undefined when no tokens have been saved', () => {
      expect(controller.getLastTokenRefreshAt()).toBeUndefined();
    });

    it('should return the last refresh time after saving tokens', async () => {
      const beforeSave = Date.now();
      await controller.saveTokens('access', 'refresh', 3600);
      const afterSave = Date.now();

      const lastRefreshAt = controller.getLastTokenRefreshAt();

      expect(lastRefreshAt).toBeDefined();
      expect(lastRefreshAt).toBeGreaterThanOrEqual(beforeSave);
      expect(lastRefreshAt).toBeLessThanOrEqual(afterSave);
    });

    it('should persist lastRefreshAt to store when saving tokens', async () => {
      await controller.saveTokens('access', 'refresh', 3600);

      expect(mockStoreManager.set).toHaveBeenCalledWith(
        'encryptedTokens',
        expect.objectContaining({
          lastRefreshAt: expect.any(Number),
        }),
      );
    });
  });

  describe('getRemoteServerUrl', () => {
    it('should return official cloud server for cloud mode', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        storageMode: 'cloud',
      });

      const result = await controller.getRemoteServerUrl();

      expect(result).toBe('https://cloud.lobehub.com');
    });

    it('should return custom URL for selfHost mode', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        remoteServerUrl: 'https://my-server.com',
        storageMode: 'selfHost',
      });

      const result = await controller.getRemoteServerUrl();

      expect(result).toBe('https://my-server.com');
    });

    it('should use provided config instead of stored config', async () => {
      const customConfig: DataSyncConfig = {
        active: true,
        remoteServerUrl: 'https://custom-server.com',
        storageMode: 'selfHost',
      };

      const result = await controller.getRemoteServerUrl(customConfig);

      expect(result).toBe('https://custom-server.com');
    });
  });

  describe('isRemoteServerConfigured', () => {
    it('should return true for active cloud mode (no remoteServerUrl needed)', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        storageMode: 'cloud',
        // remoteServerUrl is undefined for cloud mode
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(true);
    });

    it('should return true for active selfHost mode with remoteServerUrl', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        remoteServerUrl: 'https://my-server.com',
        storageMode: 'selfHost',
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(true);
    });

    it('should return false for inactive config', async () => {
      mockStoreManager.get.mockReturnValue({
        active: false,
        storageMode: 'cloud',
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(false);
    });

    it('should return false for selfHost mode without remoteServerUrl', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        storageMode: 'selfHost',
        // remoteServerUrl is undefined
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(false);
    });

    it('should use provided config instead of fetching', async () => {
      // Store has inactive config
      mockStoreManager.get.mockReturnValue({
        active: false,
        storageMode: 'cloud',
      });

      // But we provide an active config
      const result = await controller.isRemoteServerConfigured({
        active: true,
        storageMode: 'cloud',
      });

      expect(result).toBe(true);
    });
  });
});
