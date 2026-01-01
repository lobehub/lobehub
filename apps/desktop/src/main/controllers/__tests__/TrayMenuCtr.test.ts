import {
  ShowTrayNotificationParams,
  UpdateTrayIconParams,
  UpdateTrayTooltipParams,
} from '@lobechat/electron-client-ipc';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import TrayMenuCtr from '../TrayMenuCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

// 模拟 logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// 保存原始平台，确保测试结束后能恢复
const originalPlatform = process.platform;

// 模拟 App 及其依赖项
const mockToggleVisible = vi.fn();
const mockGetMainWindow = vi.fn(() => ({
  toggleVisible: mockToggleVisible,
}));

const mockDisplayBalloon = vi.fn();
const mockUpdateIcon = vi.fn();
const mockUpdateTooltip = vi.fn();
const mockGetMainTray = vi.fn();

const mockApp = {
  browserManager: {
    getMainWindow: mockGetMainWindow,
  },
  trayManager: {
    getMainTray: mockGetMainTray,
  },
} as unknown as App;

describe('TrayMenuCtr', () => {
  let trayMenuCtr: TrayMenuCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMainHandleMock.mockClear();
    // 为每个测试重置 mockedTray
    mockGetMainTray.mockReset();
    trayMenuCtr = new TrayMenuCtr(mockApp);
  });

  // 在所有测试完成后恢复平台设置
  afterAll(() => {
    // 恢复原始平台
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('toggleMainWindow', () => {
    it('should get the main window and toggle its visibility', async () => {
      await trayMenuCtr.toggleMainWindow();

      expect(mockGetMainWindow).toHaveBeenCalled();
      expect(mockToggleVisible).toHaveBeenCalled();
    });
  });

  describe('showNotification', () => {
    it('should display balloon notification on Windows platform', async () => {
      // 模拟 Windows 平台
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockedTray = {
        displayBalloon: mockDisplayBalloon,
      };
      mockGetMainTray.mockReturnValue(mockedTray);

      const options: ShowTrayNotificationParams = {
        title: 'Test Notification',
        content: 'This is a test notification',
        iconType: 'info',
      };

      const result = await trayMenuCtr.showNotification(options);

      expect(mockGetMainTray).toHaveBeenCalled();
      expect(mockDisplayBalloon).toHaveBeenCalledWith({
        title: options.title,
        content: options.content,
        iconType: options.iconType,
      });
      expect(result).toEqual({ success: true });
    });

    it('should return error when not on Windows platform', async () => {
      // 模拟非 Windows 平台
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const options: ShowTrayNotificationParams = {
        title: 'Test Notification',
        content: 'This is a test notification',
      };

      const result = await trayMenuCtr.showNotification(options);

      expect(mockGetMainTray).not.toHaveBeenCalled();
      expect(mockDisplayBalloon).not.toHaveBeenCalled();
      expect(result).toEqual({
        error: 'Tray notifications are only supported on Windows platform',
        success: false,
      });
    });

    it('should return error when tray is not available on Windows', async () => {
      // 模拟 Windows 平台但没有托盘
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockGetMainTray.mockReturnValue(null);

      const options: ShowTrayNotificationParams = {
        title: 'Test Notification',
        content: 'This is a test notification',
      };

      const result = await trayMenuCtr.showNotification(options);

      expect(mockGetMainTray).toHaveBeenCalled();
      expect(mockDisplayBalloon).not.toHaveBeenCalled();
      expect(result).toEqual({
        error: 'Tray notifications are only supported on Windows platform',
        success: false,
      });
    });
  });

  describe('updateTrayIcon', () => {
    it('should update tray icon on Windows platform', async () => {
      // 模拟 Windows 平台
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockedTray = {
        updateIcon: mockUpdateIcon,
      };
      mockGetMainTray.mockReturnValue(mockedTray);

      const options: UpdateTrayIconParams = {
        iconPath: '/path/to/icon.png',
      };

      const result = await trayMenuCtr.updateTrayIcon(options);

      expect(mockGetMainTray).toHaveBeenCalled();
      expect(mockUpdateIcon).toHaveBeenCalledWith(options.iconPath);
      expect(result).toEqual({ success: true });
    });

    it('should handle errors when updating icon', async () => {
      // 模拟 Windows 平台
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const error = new Error('Failed to update icon');
      const mockedTray = {
        updateIcon: vi.fn().mockImplementation(() => {
          throw error;
        }),
      };
      mockGetMainTray.mockReturnValue(mockedTray);

      const options: UpdateTrayIconParams = {
        iconPath: '/path/to/icon.png',
      };

      const result = await trayMenuCtr.updateTrayIcon(options);

      expect(result).toEqual({
        error: String(error),
        success: false,
      });
    });

    it('should return error when not on Windows platform', async () => {
      // 模拟非 Windows 平台
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const options: UpdateTrayIconParams = {
        iconPath: '/path/to/icon.png',
      };

      const result = await trayMenuCtr.updateTrayIcon(options);

      expect(result).toEqual({
        error: 'Tray functionality is only supported on Windows platform',
        success: false,
      });
    });
  });

  describe('updateTrayTooltip', () => {
    it('should update tray tooltip on Windows platform', async () => {
      // 模拟 Windows 平台
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockedTray = {
        updateTooltip: mockUpdateTooltip,
      };
      mockGetMainTray.mockReturnValue(mockedTray);

      const options: UpdateTrayTooltipParams = {
        tooltip: 'New tooltip text',
      };

      const result = await trayMenuCtr.updateTrayTooltip(options);

      expect(mockGetMainTray).toHaveBeenCalled();
      expect(mockUpdateTooltip).toHaveBeenCalledWith(options.tooltip);
      expect(result).toEqual({ success: true });
    });

    it('should return error when not on Windows platform', async () => {
      // 模拟非 Windows 平台
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const options: UpdateTrayTooltipParams = {
        tooltip: 'New tooltip text',
      };

      const result = await trayMenuCtr.updateTrayTooltip(options);

      expect(result).toEqual({
        error: 'Tray functionality is only supported on Windows platform',
        success: false,
      });
    });

    it('should return error when tooltip is not provided', async () => {
      // 模拟 Windows 平台
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockedTray = {
        updateTooltip: mockUpdateTooltip,
      };
      mockGetMainTray.mockReturnValue(mockedTray);

      const options: UpdateTrayTooltipParams = {
        tooltip: undefined as any,
      };

      const result = await trayMenuCtr.updateTrayTooltip(options);

      expect(mockUpdateTooltip).not.toHaveBeenCalled();
      expect(result).toEqual({
        error: 'Tray functionality is only supported on Windows platform',
        success: false,
      });
    });
  });
});
