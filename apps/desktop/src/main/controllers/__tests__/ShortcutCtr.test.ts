import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import ShortcutController from '../ShortcutCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

// 模拟 App 及其依赖项
const mockGetShortcutsConfig = vi.fn().mockReturnValue({
  toggleMainWindow: 'CommandOrControl+Shift+L',
  openSettings: 'CommandOrControl+,',
});
const mockUpdateShortcutConfig = vi.fn().mockImplementation((id, accelerator) => {
  // 简单模拟更新成功
  return true;
});

const mockApp = {
  shortcutManager: {
    getShortcutsConfig: mockGetShortcutsConfig,
    updateShortcutConfig: mockUpdateShortcutConfig,
  },
} as unknown as App;

describe('ShortcutController', () => {
  let shortcutController: ShortcutController;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMainHandleMock.mockClear();
    shortcutController = new ShortcutController(mockApp);
  });

  describe('getShortcutsConfig', () => {
    it('should return shortcuts config from shortcutManager', () => {
      const result = shortcutController.getShortcutsConfig();

      expect(mockGetShortcutsConfig).toHaveBeenCalled();
      expect(result).toEqual({
        toggleMainWindow: 'CommandOrControl+Shift+L',
        openSettings: 'CommandOrControl+,',
      });
    });
  });

  describe('updateShortcutConfig', () => {
    it('should call shortcutManager.updateShortcutConfig with correct parameters', () => {
      const id = 'toggleMainWindow';
      const accelerator = 'CommandOrControl+Alt+L';

      const result = shortcutController.updateShortcutConfig({ id, accelerator });

      expect(mockUpdateShortcutConfig).toHaveBeenCalledWith(id, accelerator);
      expect(result).toBe(true);
    });

    it('should return the result from shortcutManager.updateShortcutConfig', () => {
      // 模拟更新失败的情况
      mockUpdateShortcutConfig.mockReturnValueOnce(false);

      const result = shortcutController.updateShortcutConfig({
        id: 'invalidKey',
        accelerator: 'invalid+combo',
      });

      expect(result).toBe(false);
    });
  });
});
