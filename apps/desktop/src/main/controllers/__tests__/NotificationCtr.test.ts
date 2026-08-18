import type { ShowDesktopNotificationParams } from '@lobechat/electron-client-ipc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import NotificationCtr from '../NotificationCtr';

const { ipcMainHandleMock, loggerMock, macNotificationsMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  loggerMock: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  macNotificationsMock: {
    getAuthorizationStatus: vi.fn(async () => 'authorized'),
    isSupported: vi.fn(() => false),
    onNotificationEvent: vi.fn(
      (_listener: (event: { id: string; type: string }) => void) => () => {},
    ),
    requestAuthorization: vi.fn(async () => true),
    showNotification: vi.fn(async (): Promise<{ id: string; ok: boolean; reason?: string }> => ({
      id: 'lobehub-test-id',
      ok: true,
    })),
  },
}));

vi.mock('@lobechat/electron-mac-notifications', () => macNotificationsMock);

vi.mock('@/utils/logger', () => ({
  createLogger: () => loggerMock,
}));

// Mock electron
vi.mock('electron', () => {
  const mockNotificationInstance = {
    on: vi.fn(),
    show: vi.fn(),
  };
  const MockNotification = vi.fn(() => mockNotificationInstance) as any;
  MockNotification.isSupported = vi.fn(() => true);

  return {
    ipcMain: {
      handle: ipcMainHandleMock,
    },
    Notification: MockNotification,
    app: {
      dock: {
        bounce: vi.fn(),
      },
      setAppUserModelId: vi.fn(),
    },
  };
});

// Mock platform detection
vi.mock('@/utils/platform', () => ({
  linux: vi.fn(() => false),
  macOS: vi.fn(() => false),
  windows: vi.fn(() => false),
}));

// Mock browserManager
const mockBrowserWindow = {
  flashFrame: vi.fn(),
  focus: vi.fn(),
  isDestroyed: vi.fn(() => false),
  isFocused: vi.fn(() => true),
  isMinimized: vi.fn(() => false),
  isVisible: vi.fn(() => true),
};

const mockMainWindow = {
  broadcast: vi.fn(),
  browserWindow: mockBrowserWindow,
  show: vi.fn(),
};

const mockBrowserManager = {
  getMainWindow: vi.fn(() => mockMainWindow),
  showMainWindow: vi.fn(),
};

const mockApp = {
  browserManager: mockBrowserManager,
} as unknown as App;

describe('NotificationCtr', () => {
  let controller: NotificationCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMainHandleMock.mockClear();
    vi.useFakeTimers();
    controller = new NotificationCtr(mockApp);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('afterAppReady', () => {
    it('should setup notifications when supported', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);

      controller.afterAppReady();

      expect(Notification.isSupported).toHaveBeenCalled();
    });

    it('should not setup when notifications are not supported', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(false);

      controller.afterAppReady();

      expect(Notification.isSupported).toHaveBeenCalled();
    });

    it('should set app user model ID on Windows', async () => {
      const { windows } = await import('@/utils/platform');
      const { app, Notification } = await import('electron');
      vi.mocked(windows).mockReturnValue(true);
      vi.mocked(Notification.isSupported).mockReturnValue(true);

      controller.afterAppReady();

      expect(app.setAppUserModelId).toHaveBeenCalledWith('com.lobehub.chat');

      vi.mocked(windows).mockReturnValue(false);
    });

    it('should handle macOS platform', async () => {
      const { macOS } = await import('@/utils/platform');
      const { Notification } = await import('electron');
      vi.mocked(macOS).mockReturnValue(true);
      vi.mocked(Notification.isSupported).mockReturnValue(true);

      // Should not throw
      expect(() => controller.afterAppReady()).not.toThrow();

      vi.mocked(macOS).mockReturnValue(false);
    });
  });

  describe('showDesktopNotification', () => {
    const params: ShowDesktopNotificationParams = {
      body: 'Test body',
      title: 'Test title',
    };

    it('should return error when notifications are not supported', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(false);

      const result = await controller.showDesktopNotification(params);

      expect(result).toEqual({
        error: 'Desktop notifications not supported',
        success: false,
      });
    });

    it('does not log the avatar data URL', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(true);
      mockBrowserWindow.isFocused.mockReturnValue(true);
      mockBrowserWindow.isMinimized.mockReturnValue(false);

      const avatarDataUrl = `data:image/png;base64,${'A'.repeat(80)}`;
      await controller.showDesktopNotification({
        ...params,
        sender: { avatarDataUrl, conversationId: 'a1', name: 'Agent' },
      });

      expect(loggerMock.debug).toHaveBeenCalledWith(
        'Received desktop notification request:',
        expect.objectContaining({
          sender: { avatarDataUrl: '[redacted]', conversationId: 'a1', name: 'Agent' },
        }),
      );
      expect(JSON.stringify(loggerMock.debug.mock.calls)).not.toContain(avatarDataUrl);
    });

    it('should skip notification when window is visible and focused', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(true);
      mockBrowserWindow.isFocused.mockReturnValue(true);
      mockBrowserWindow.isMinimized.mockReturnValue(false);

      const result = await controller.showDesktopNotification(params);

      expect(result).toEqual({
        reason: 'Window is visible',
        skipped: true,
        success: true,
      });
    });

    it('should show notification when window is hidden', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(false);

      const promise = controller.showDesktopNotification(params);
      vi.advanceTimersByTime(100);
      const result = await promise;

      expect(Notification).toHaveBeenCalledWith({
        body: 'Test body',
        hasReply: false,
        silent: false,
        timeoutType: 'default',
        title: 'Test title',
        urgency: 'normal',
      });
      expect(result).toEqual({ success: true });
    });

    it('should show notification when force is true even if window is visible and focused', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(true);
      mockBrowserWindow.isFocused.mockReturnValue(true);
      mockBrowserWindow.isMinimized.mockReturnValue(false);

      const promise = controller.showDesktopNotification({
        ...params,
        force: true,
      });
      vi.advanceTimersByTime(100);
      const result = await promise;

      expect(Notification).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should use low urgency on Linux to prevent GNOME Shell freeze', async () => {
      const { linux } = await import('@/utils/platform');
      const { Notification } = await import('electron');
      vi.mocked(linux).mockReturnValue(true);
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(false);

      const promise = controller.showDesktopNotification(params);
      vi.advanceTimersByTime(100);
      await promise;

      expect(Notification).toHaveBeenCalledWith(
        expect.objectContaining({
          urgency: 'low',
        }),
      );

      vi.mocked(linux).mockReturnValue(false);
    });

    it('should show notification when window is minimized', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(true);
      mockBrowserWindow.isFocused.mockReturnValue(true);
      mockBrowserWindow.isMinimized.mockReturnValue(true);

      const promise = controller.showDesktopNotification(params);
      vi.advanceTimersByTime(100);
      const result = await promise;

      expect(Notification).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should show notification when window is not focused', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(true);
      mockBrowserWindow.isFocused.mockReturnValue(false);
      mockBrowserWindow.isMinimized.mockReturnValue(false);

      const promise = controller.showDesktopNotification(params);
      vi.advanceTimersByTime(100);
      const result = await promise;

      expect(Notification).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should pass silent option to notification', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(false);

      const paramsWithSilent: ShowDesktopNotificationParams = {
        ...params,
        silent: true,
      };

      const promise = controller.showDesktopNotification(paramsWithSilent);
      vi.advanceTimersByTime(100);
      await promise;

      expect(Notification).toHaveBeenCalledWith(
        expect.objectContaining({
          silent: true,
        }),
      );
    });

    it('should request window attention when requested and window is hidden', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(false);

      const promise = controller.showDesktopNotification({
        ...params,
        requestAttention: true,
      });
      vi.advanceTimersByTime(100);
      await promise;

      expect(mockBrowserWindow.flashFrame).toHaveBeenCalledWith(true);
    });

    it('should bounce dock on macOS when attention is requested', async () => {
      const { app, Notification } = await import('electron');
      const { macOS } = await import('@/utils/platform');
      vi.mocked(macOS).mockReturnValue(true);
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(false);

      const promise = controller.showDesktopNotification({
        ...params,
        requestAttention: true,
      });
      vi.advanceTimersByTime(100);
      await promise;

      expect(app.dock.bounce).toHaveBeenCalledWith('informational');

      vi.mocked(macOS).mockReturnValue(false);
    });

    it('should register click handler to show main window', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(false);

      // Get the mock instance that will be created
      const mockInstance = { on: vi.fn(), show: vi.fn() };
      vi.mocked(Notification).mockReturnValue(mockInstance as any);

      const promise = controller.showDesktopNotification(params);
      vi.advanceTimersByTime(100);
      await promise;

      // Find the click handler
      const clickHandler = mockInstance.on.mock.calls.find((call) => call[0] === 'click')?.[1];

      expect(clickHandler).toBeDefined();

      // Simulate click
      clickHandler();

      // Delegates to the shared show path, which restores a minimized window
      // before showing/focusing — a bare `show()` cannot un-minimize on macOS.
      expect(mockBrowserManager.showMainWindow).toHaveBeenCalled();
    });

    it('should handle notification error', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(false);
      vi.mocked(Notification).mockImplementationOnce(() => {
        throw new Error('Notification error');
      });

      const result = await controller.showDesktopNotification(params);

      expect(result).toEqual({
        error: 'Notification error',
        success: false,
      });
    });

    it('should handle unknown error type', async () => {
      const { Notification } = await import('electron');
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(false);
      vi.mocked(Notification).mockImplementationOnce(() => {
        throw 'string error';
      });

      const result = await controller.showDesktopNotification(params);

      expect(result).toEqual({
        error: 'Unknown error',
        success: false,
      });
    });
  });

  describe('isMainWindowHidden', () => {
    it('should return false when window is visible and focused', () => {
      mockBrowserWindow.isVisible.mockReturnValue(true);
      mockBrowserWindow.isFocused.mockReturnValue(true);
      mockBrowserWindow.isMinimized.mockReturnValue(false);
      mockBrowserWindow.isDestroyed.mockReturnValue(false);

      const result = controller.isMainWindowHidden();

      expect(result).toBe(false);
    });

    it('should return true when window is not visible', () => {
      mockBrowserWindow.isVisible.mockReturnValue(false);
      mockBrowserWindow.isFocused.mockReturnValue(true);
      mockBrowserWindow.isMinimized.mockReturnValue(false);
      mockBrowserWindow.isDestroyed.mockReturnValue(false);

      const result = controller.isMainWindowHidden();

      expect(result).toBe(true);
    });

    it('should return true when window is minimized', () => {
      mockBrowserWindow.isVisible.mockReturnValue(true);
      mockBrowserWindow.isFocused.mockReturnValue(true);
      mockBrowserWindow.isMinimized.mockReturnValue(true);
      mockBrowserWindow.isDestroyed.mockReturnValue(false);

      const result = controller.isMainWindowHidden();

      expect(result).toBe(true);
    });

    it('should return true when window is not focused', () => {
      mockBrowserWindow.isVisible.mockReturnValue(true);
      mockBrowserWindow.isFocused.mockReturnValue(false);
      mockBrowserWindow.isMinimized.mockReturnValue(false);
      mockBrowserWindow.isDestroyed.mockReturnValue(false);

      const result = controller.isMainWindowHidden();

      expect(result).toBe(true);
    });

    it('should return true when window is destroyed', () => {
      mockBrowserWindow.isDestroyed.mockReturnValue(true);

      const result = controller.isMainWindowHidden();

      expect(result).toBe(true);
    });

    it('should return true on error', () => {
      mockBrowserManager.getMainWindow.mockImplementationOnce(() => {
        throw new Error('Window not available');
      });

      const result = controller.isMainWindowHidden();

      expect(result).toBe(true);
    });
  });

  describe('macOS communication notifications', () => {
    const params: ShowDesktopNotificationParams = {
      body: 'Reply body',
      sender: { conversationId: 'agent-1:topic-1', name: 'My Agent' },
      title: 'My Agent',
    };

    const enableMacAddon = async () => {
      const { macOS } = await import('@/utils/platform');
      const { Notification } = await import('electron');
      vi.mocked(macOS).mockReturnValue(true);
      vi.mocked(Notification.isSupported).mockReturnValue(true);
      macNotificationsMock.isSupported.mockReturnValue(true);
      mockBrowserWindow.isVisible.mockReturnValue(false);
    };

    afterEach(async () => {
      const { macOS } = await import('@/utils/platform');
      vi.mocked(macOS).mockReturnValue(false);
      macNotificationsMock.isSupported.mockReturnValue(false);
    });

    it('routes notifications through the native addon instead of Electron', async () => {
      await enableMacAddon();
      const { Notification } = await import('electron');

      const result = await controller.showDesktopNotification(params);

      expect(macNotificationsMock.showNotification).toHaveBeenCalledWith({
        body: 'Reply body',
        sender: params.sender,
        silent: undefined,
        title: 'My Agent',
      });
      expect(Notification).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('falls back to the Electron notification when the addon reports failure', async () => {
      await enableMacAddon();
      const { Notification } = await import('electron');
      macNotificationsMock.showNotification.mockResolvedValueOnce({
        id: 'lobehub-x',
        ok: false,
        reason: 'denied',
      });

      const promise = controller.showDesktopNotification(params);
      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(Notification).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('navigates when a mac notification is clicked', async () => {
      await enableMacAddon();
      let handler: (event: { id: string; type: string }) => void = () => {};
      macNotificationsMock.onNotificationEvent.mockImplementation((listener) => {
        handler = listener;
        return () => {};
      });
      macNotificationsMock.showNotification.mockResolvedValueOnce({ id: 'lobehub-nav', ok: true });
      const navigate = { escape: true, path: '/agent/a1/t1' };

      controller.afterAppReady();
      await controller.showDesktopNotification({ ...params, navigate });

      handler({ id: 'lobehub-nav', type: 'clicked' });

      expect(mockBrowserManager.showMainWindow).toHaveBeenCalled();
      expect(mockMainWindow.broadcast).toHaveBeenCalledWith('navigate', navigate);
    });

    it('reports permission status from the addon', async () => {
      await enableMacAddon();

      macNotificationsMock.getAuthorizationStatus.mockResolvedValueOnce('denied');
      expect(await controller.getNotificationPermissionStatus()).toBe('denied');

      macNotificationsMock.getAuthorizationStatus.mockResolvedValueOnce('provisional');
      expect(await controller.getNotificationPermissionStatus()).toBe('authorized');
    });

    it('requests permission through the addon without showing a test notification', async () => {
      await enableMacAddon();
      const { Notification } = await import('electron');

      await controller.requestNotificationPermission();

      expect(macNotificationsMock.requestAuthorization).toHaveBeenCalled();
      expect(Notification).not.toHaveBeenCalled();
    });
  });
});
