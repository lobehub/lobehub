import type { ShowDesktopNotificationParams } from '@lobechat/electron-client-ipc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import NotificationCtr from '../NotificationCtr.mac';

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
    isSupported: vi.fn(() => true),
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
        setBadge: vi.fn(),
      },
      setAppUserModelId: vi.fn(),
      setBadgeCount: vi.fn(),
    },
  };
});

const mockBrowserWindow = {
  flashFrame: vi.fn(),
  isDestroyed: vi.fn(() => false),
  isFocused: vi.fn(() => true),
  isMinimized: vi.fn(() => false),
  isVisible: vi.fn(() => true),
  webContents: {
    executeJavaScript: vi.fn(),
  },
};

const mockMainWindow = {
  broadcast: vi.fn(),
  browserWindow: mockBrowserWindow,
};

const mockBrowserManager = {
  getMainWindow: vi.fn(() => mockMainWindow),
  showMainWindow: vi.fn(),
};

const mockApp = {
  browserManager: mockBrowserManager,
} as unknown as App;

describe('NotificationCtr.mac', () => {
  let controller: NotificationCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    macNotificationsMock.isSupported.mockReturnValue(true);
    controller = new NotificationCtr(mockApp);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const params: ShowDesktopNotificationParams = {
    body: 'Reply body',
    sender: { conversationId: 'agent-1:topic-1', name: 'My Agent' },
    title: 'My Agent',
  };

  it('routes notifications through the native addon instead of Electron', async () => {
    const { Notification } = await import('electron');
    mockBrowserWindow.isVisible.mockReturnValue(false);

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
    const { Notification } = await import('electron');
    mockBrowserWindow.isVisible.mockReturnValue(false);
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
    mockBrowserWindow.isVisible.mockReturnValue(false);
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
    macNotificationsMock.getAuthorizationStatus.mockResolvedValueOnce('denied');
    expect(await controller.getNotificationPermissionStatus()).toBe('denied');

    macNotificationsMock.getAuthorizationStatus.mockResolvedValueOnce('provisional');
    expect(await controller.getNotificationPermissionStatus()).toBe('authorized');
  });

  it('requests permission through the addon without showing a test notification', async () => {
    const { Notification } = await import('electron');

    await controller.requestNotificationPermission();

    expect(macNotificationsMock.requestAuthorization).toHaveBeenCalled();
    expect(Notification).not.toHaveBeenCalled();
  });

  it('bounces the dock when attention is requested', async () => {
    const { app } = await import('electron');
    mockBrowserWindow.isVisible.mockReturnValue(false);

    await controller.showDesktopNotification({
      ...params,
      requestAttention: true,
    });

    expect(app.dock.bounce).toHaveBeenCalledWith('informational');
  });

  it('pairs setBadgeCount with the dock badge', async () => {
    const { app } = await import('electron');

    controller.setBadgeCount(3);

    expect(app.setBadgeCount).toHaveBeenCalledWith(3);
    expect(app.dock.setBadge).toHaveBeenCalledWith('3');
  });
});
