import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import MenuController from '../MenuCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

// 模拟 App 及其依赖项
const mockRefreshMenus = vi.fn();
const mockShowContextMenu = vi.fn();
const mockRebuildAppMenu = vi.fn();

const mockApp = {
  menuManager: {
    refreshMenus: mockRefreshMenus,
    showContextMenu: mockShowContextMenu,
    rebuildAppMenu: mockRebuildAppMenu,
  },
} as unknown as App;

describe('MenuController', () => {
  let menuController: MenuController;

  beforeEach(() => {
    vi.clearAllMocks();
    menuController = new MenuController(mockApp);
  });

  describe('refreshAppMenu', () => {
    it('should call menuManager.refreshMenus', () => {
      // 模拟返回值
      mockRefreshMenus.mockReturnValueOnce(true);

      const result = menuController.refreshAppMenu();

      expect(mockRefreshMenus).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('showContextMenu', () => {
    it('should call menuManager.showContextMenu with type only', () => {
      const menuType = 'chat';
      mockShowContextMenu.mockReturnValueOnce({ shown: true });

      const result = menuController.showContextMenu({ type: menuType });

      expect(mockShowContextMenu).toHaveBeenCalledWith(menuType, undefined);
      expect(result).toEqual({ shown: true });
    });

    it('should call menuManager.showContextMenu with type and data', () => {
      const menuType = 'file';
      const menuData = { fileId: '123', filePath: '/path/to/file.txt' };
      mockShowContextMenu.mockReturnValueOnce({ shown: true });

      const result = menuController.showContextMenu({ type: menuType, data: menuData });

      expect(mockShowContextMenu).toHaveBeenCalledWith(menuType, menuData);
      expect(result).toEqual({ shown: true });
    });
  });

  describe('setDevMenuVisibility', () => {
    it('should call menuManager.rebuildAppMenu with showDevItems true', () => {
      mockRebuildAppMenu.mockReturnValueOnce(true);

      const result = menuController.setDevMenuVisibility(true);

      expect(mockRebuildAppMenu).toHaveBeenCalledWith({ showDevItems: true });
      expect(result).toBe(true);
    });

    it('should call menuManager.rebuildAppMenu with showDevItems false', () => {
      mockRebuildAppMenu.mockReturnValueOnce(true);

      const result = menuController.setDevMenuVisibility(false);

      expect(mockRebuildAppMenu).toHaveBeenCalledWith({ showDevItems: false });
      expect(result).toBe(true);
    });
  });
});
