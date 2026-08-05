import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import type { IpcContext } from '@/utils/ipc';
import { runWithIpcContext } from '@/utils/ipc';

import MenuController from '../MenuCtr';

const { fromWebContentsMock, ipcMainHandleMock } = vi.hoisted(() => ({
  fromWebContentsMock: vi.fn(),
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: fromWebContentsMock,
  },
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

// Mock App and its dependencies
const mockRefreshMenus = vi.fn();
const mockShowContextMenu = vi.fn();
const mockRebuildAppMenu = vi.fn();
const mockPopupContextMenu = vi.fn();
const mockClosePopupContextMenu = vi.fn();

const mockApp = {
  menuManager: {
    closePopupContextMenu: mockClosePopupContextMenu,
    popupContextMenu: mockPopupContextMenu,
    refreshMenus: mockRefreshMenus,
    rebuildAppMenu: mockRebuildAppMenu,
    showContextMenu: mockShowContextMenu,
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
      // Mock return value
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

  describe('popupContextMenu', () => {
    it('should resolve the calling window via BrowserWindow.fromWebContents and delegate to menuManager', async () => {
      const params = { items: [{ id: 'copy', label: 'Copy', type: 'normal' as const }] };
      const sender = {} as any;
      const context = { event: { sender } as any, sender } as IpcContext;
      const mockWindow = {} as any;
      fromWebContentsMock.mockReturnValueOnce(mockWindow);
      mockPopupContextMenu.mockResolvedValueOnce({ clickedId: 'copy' });

      const result = await runWithIpcContext(context, () =>
        menuController.popupContextMenu(params),
      );

      expect(fromWebContentsMock).toHaveBeenCalledWith(sender);
      expect(mockPopupContextMenu).toHaveBeenCalledWith(params, mockWindow);
      expect(result).toEqual({ clickedId: 'copy' });
    });

    it('should pass a null window through when there is no IPC context', async () => {
      const params = { items: [] };
      mockPopupContextMenu.mockResolvedValueOnce({ clickedId: null });

      const result = await menuController.popupContextMenu(params);

      expect(fromWebContentsMock).not.toHaveBeenCalled();
      expect(mockPopupContextMenu).toHaveBeenCalledWith(params, null);
      expect(result).toEqual({ clickedId: null });
    });
  });

  describe('closePopupContextMenu', () => {
    it('should call menuManager.closePopupContextMenu', () => {
      mockClosePopupContextMenu.mockReturnValueOnce({ success: true });

      const result = menuController.closePopupContextMenu();

      expect(mockClosePopupContextMenu).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });
});
