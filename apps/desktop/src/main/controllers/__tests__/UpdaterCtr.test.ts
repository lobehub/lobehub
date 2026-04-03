import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import UpdaterCtr from '../UpdaterCtr';

// 模拟 logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@/modules/updater/configs', () => ({
  UPDATE_CHANNEL: 'stable',
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
const mockGetUpdaterState = vi.fn();
const mockSwitchChannel = vi.fn();
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
    getUpdaterState: mockGetUpdaterState,
    installNow: mockInstallNow,
    installLater: mockInstallLater,
    switchChannel: mockSwitchChannel,
  },
} as unknown as App;

describe('UpdaterCtr', () => {
  let updaterCtr: UpdaterCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMainHandleMock.mockClear();
    mockStoreGet.mockReset();
    mockStoreSet.mockReset();
    updaterCtr = new UpdaterCtr(mockApp);
  });

  describe('checkForUpdates', () => {
    it('should call updaterManager.checkForUpdates', async () => {
      await updaterCtr.checkForUpdates();
      expect(mockCheckForUpdates).toHaveBeenCalled();
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

  describe('update channel', () => {
    it('should return stored update channel', async () => {
      mockStoreGet.mockReturnValueOnce('canary');

      await expect(updaterCtr.getUpdateChannel()).resolves.toBe('canary');
    });

    it('should return default update channel when store is empty', async () => {
      mockStoreGet.mockReturnValueOnce(undefined);

      await expect(updaterCtr.getUpdateChannel()).resolves.toBe('stable');
    });

    it('should keep canary input unchanged', async () => {
      await updaterCtr.setUpdateChannel('canary');

      expect(mockStoreSet).toHaveBeenCalledWith('updateChannel', 'canary');
      expect(mockSwitchChannel).toHaveBeenCalledWith('canary');
    });

    it('should ignore invalid legacy input', async () => {
      await updaterCtr.setUpdateChannel(
        'nightly' as unknown as Parameters<UpdaterCtr['setUpdateChannel']>[0],
      );

      expect(mockStoreSet).not.toHaveBeenCalled();
      expect(mockSwitchChannel).not.toHaveBeenCalled();
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
