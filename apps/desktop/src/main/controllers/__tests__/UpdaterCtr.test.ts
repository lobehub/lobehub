import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import UpdaterCtr from '../UpdaterCtr';

// 模拟 logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
  }),
}));

// 模拟 store defaults
vi.mock('@/const/store', () => ({
  STORE_DEFAULTS: {
    autoCheckUpdate: true,
  },
}));

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

// 模拟 App 及其依赖项
const mockCheckForUpdates = vi.fn();
const mockDownloadUpdate = vi.fn();
const mockInstallNow = vi.fn();
const mockInstallLater = vi.fn();
const mockSetAutoCheckEnabled = vi.fn();
const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();

const mockApp = {
  storeManager: {
    get: mockStoreGet,
    set: mockStoreSet,
  },
  updaterManager: {
    checkForUpdates: mockCheckForUpdates,
    downloadUpdate: mockDownloadUpdate,
    installLater: mockInstallLater,
    installNow: mockInstallNow,
    setAutoCheckEnabled: mockSetAutoCheckEnabled,
  },
} as unknown as App;

describe('UpdaterCtr', () => {
  let updaterCtr: UpdaterCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMainHandleMock.mockClear();
    updaterCtr = new UpdaterCtr(mockApp);
  });

  describe('checkForUpdates', () => {
    it('should call updaterManager.checkForUpdates with manual flag', async () => {
      await updaterCtr.checkForUpdates();
      expect(mockCheckForUpdates).toHaveBeenCalledWith({ manual: true });
    });
  });

  describe('downloadUpdate', () => {
    it('should call updaterManager.downloadUpdate', async () => {
      await updaterCtr.downloadUpdate();
      expect(mockDownloadUpdate).toHaveBeenCalled();
    });
  });

  describe('quitAndInstallUpdate', () => {
    it('should call updaterManager.installNow', () => {
      updaterCtr.quitAndInstallUpdate();
      expect(mockInstallNow).toHaveBeenCalled();
    });
  });

  describe('installLater', () => {
    it('should call updaterManager.installLater', () => {
      updaterCtr.installLater();
      expect(mockInstallLater).toHaveBeenCalled();
    });
  });

  describe('getAutoCheckUpdate', () => {
    it('should return the auto check update setting from store', () => {
      mockStoreGet.mockReturnValue(true);
      const result = updaterCtr.getAutoCheckUpdate();
      expect(mockStoreGet).toHaveBeenCalledWith('autoCheckUpdate', true);
      expect(result).toBe(true);
    });

    it('should return false when auto check update is disabled', () => {
      mockStoreGet.mockReturnValue(false);
      const result = updaterCtr.getAutoCheckUpdate();
      expect(result).toBe(false);
    });
  });

  describe('setAutoCheckUpdate', () => {
    it('should save the setting to store and update updater manager', () => {
      updaterCtr.setAutoCheckUpdate(false);
      expect(mockStoreSet).toHaveBeenCalledWith('autoCheckUpdate', false);
      expect(mockSetAutoCheckEnabled).toHaveBeenCalledWith(false);
    });

    it('should enable auto check update', () => {
      updaterCtr.setAutoCheckUpdate(true);
      expect(mockStoreSet).toHaveBeenCalledWith('autoCheckUpdate', true);
      expect(mockSetAutoCheckEnabled).toHaveBeenCalledWith(true);
    });
  });

  // 测试错误处理
  describe('error handling', () => {
    it('should handle errors when checking for updates', async () => {
      const error = new Error('Network error');
      mockCheckForUpdates.mockRejectedValueOnce(error);

      // 由于控制器并未明确处理并返回错误，这里我们只验证调用发生且错误正确冒泡
      await expect(updaterCtr.checkForUpdates()).rejects.toThrow(error);
    });

    it('should handle errors when downloading updates', async () => {
      const error = new Error('Download failed');
      mockDownloadUpdate.mockRejectedValueOnce(error);

      await expect(updaterCtr.downloadUpdate()).rejects.toThrow(error);
    });
  });
});
