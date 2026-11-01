import type { PermissionGuideEvent } from '@lobechat/electron-mac-permission-guide';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import {
  GRANTED_DISMISS_MS,
  PermissionGuide,
  POLL_INTERVAL_MS,
  PROMPT_SETTLE_MS,
  PROMPT_WAIT_MS,
  TITLE_SETTLE_MS,
} from '../PermissionGuide';

const { addonMock, electronMock, emit, statusMock } = vi.hoisted(() => {
  const listeners = new Set<(event: any) => void>();
  return {
    addonMock: {
      activateSettings: vi.fn(),
      hideGuide: vi.fn(),
      isSupported: vi.fn(() => true),
      onGuideEvent: vi.fn((listener: (event: any) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      showGuide: vi.fn((_state: Record<string, unknown>) => true),
    },
    electronMock: {
      app: {
        exit: vi.fn(),
        getName: vi.fn(() => 'LobeHub'),
        getPath: vi.fn(() => '/Applications/LobeHub.app/Contents/MacOS/LobeHub'),
        relaunch: vi.fn(),
      },
      screen: { getCursorScreenPoint: vi.fn(() => ({ x: 400, y: 300 })) },
      shell: { openExternal: vi.fn(async () => undefined) },
    },
    emit: (event: any) => listeners.forEach((listener) => listener(event)),
    statusMock: vi.fn(() => 'denied'),
  };
});

vi.mock('electron', () => electronMock);
vi.mock('@lobechat/electron-mac-permission-guide', () => addonMock);
vi.mock('@/utils/platform', () => ({ macOS: vi.fn(() => true) }));
vi.mock('@/utils/permissions', () => ({
  getAccessibilityStatus: statusMock,
  getFullDiskAccessStatus: statusMock,
  getInputMonitoringStatus: statusMock,
  getScreenCaptureStatus: statusMock,
}));

const showMainWindow = vi.fn();
const broadcastToAllWindows = vi.fn();
const mainWindowBounds = { height: 800, width: 1200, x: 100, y: 100 };
const mockApp = {
  browserManager: {
    broadcastToAllWindows,
    getMainWindow: () => ({ browserWindow: { getBounds: () => mainWindowBounds } }),
    showMainWindow,
  },
  i18n: {
    ns: () => (key: string, options?: Record<string, string>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  },
} as unknown as App;

const lastState = () => addonMock.showGuide.mock.lastCall?.[0];
const fire = (event: PermissionGuideEvent) => emit(event);

describe('PermissionGuide', () => {
  let guide: PermissionGuide;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    statusMock.mockReturnValue('denied');
    addonMock.isSupported.mockReturnValue(true);
    (process as any).getSystemVersion = vi.fn(() => '27.0.1');
    guide = new PermissionGuide(mockApp);
  });

  afterEach(() => {
    guide.close();
    vi.useRealTimers();
  });

  it('does nothing when the permission is already granted', async () => {
    statusMock.mockReturnValue('granted');

    await expect(guide.open('accessibility')).resolves.toBe(true);

    expect(electronMock.shell.openExternal).not.toHaveBeenCalled();
    expect(addonMock.showGuide).not.toHaveBeenCalled();
  });

  it('reports unavailable when the native addon is not supported', async () => {
    addonMock.isSupported.mockReturnValue(false);

    await expect(guide.open('accessibility')).resolves.toBe(false);
    expect(electronMock.shell.openExternal).not.toHaveBeenCalled();
  });

  it('opens the privacy pane and offers the app bundle as a drag source', async () => {
    await expect(guide.open('accessibility')).resolves.toBe(true);

    expect(electronMock.shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    );
    expect(addonMock.activateSettings).toHaveBeenCalled();
    expect(lastState()).toMatchObject({
      accessory: 'appIcon',
      appPath: '/Applications/LobeHub.app',
      draggable: true,
      sidebarWidth: 232,
      title: 'permissionGuide.waiting.title',
    });
  });

  it('flies out of the clicked control inside the main window', async () => {
    await guide.open('accessibility');
    expect(lastState()).toMatchObject({ launchOrigin: { x: 400, y: 300 } });
  });

  it('flies out of the main window center when the request came from elsewhere', async () => {
    electronMock.screen.getCursorScreenPoint.mockReturnValueOnce({ x: 2000, y: 10 });

    await guide.open('accessibility');

    expect(lastState()).toMatchObject({ launchOrigin: { x: 700, y: 500 } });
  });

  it('shows success, then dismisses and returns to the app once granted', async () => {
    await guide.open('accessibility');
    statusMock.mockReturnValue('granted');

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(lastState()).toMatchObject({ accessory: 'success', draggable: false });

    vi.advanceTimersByTime(GRANTED_DISMISS_MS);
    expect(addonMock.hideGuide).toHaveBeenCalled();
    expect(showMainWindow).toHaveBeenCalled();
  });

  it('tells the renderer when the guide opens and when it is granted', async () => {
    await guide.open('screen');
    expect(broadcastToAllWindows).toHaveBeenCalledWith('permissionGuideChanged', {
      permission: 'screen',
      status: 'active',
    });

    statusMock.mockReturnValue('granted');
    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(broadcastToAllWindows).toHaveBeenLastCalledWith('permissionGuideChanged', {
      permission: 'screen',
      status: 'granted',
    });

    guide.close();
    expect(broadcastToAllWindows).not.toHaveBeenCalledWith('permissionGuideChanged', {
      permission: 'screen',
      status: 'dismissed',
    });
  });

  it('tells the renderer when the guide is closed before granting', async () => {
    await guide.open('accessibility');

    fire({ type: 'close' });

    expect(broadcastToAllWindows).toHaveBeenLastCalledWith('permissionGuideChanged', {
      permission: 'accessibility',
      status: 'dismissed',
    });
  });

  it('asks to relaunch after Screen Recording is granted', async () => {
    await guide.open('screen');
    statusMock.mockReturnValue('granted');

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(lastState()).toMatchObject({ actionLabel: 'permissionGuide.relaunch.action' });

    fire({ type: 'action' });
    expect(electronMock.app.relaunch).toHaveBeenCalled();
    expect(electronMock.app.exit).toHaveBeenCalledWith(0);
  });

  it('returns to the drag state when a drop raises no system prompt', async () => {
    await guide.open('accessibility');

    fire({ dropped: true, type: 'dragEnded' });
    expect(lastState()).toMatchObject({ accessory: 'spinner' });

    vi.advanceTimersByTime(PROMPT_WAIT_MS);
    expect(lastState()).toMatchObject({ accessory: 'appIcon', draggable: true });
  });

  it('offers a retry when the password prompt is cancelled', async () => {
    await guide.open('fullDisk');

    fire({ dropped: true, type: 'dragEnded' });
    fire({ type: 'promptShown' });
    vi.advanceTimersByTime(PROMPT_WAIT_MS * 3);
    expect(lastState()).toMatchObject({ accessory: 'spinner' });

    fire({ type: 'promptDismissed' });
    vi.advanceTimersByTime(PROMPT_SETTLE_MS);
    expect(lastState()).toMatchObject({
      accessory: 'appIcon',
      draggable: true,
      subtitle: 'permissionGuide.retry.subtitle',
    });

    fire({ dropped: true, type: 'dragEnded' });
    expect(lastState()).toMatchObject({ accessory: 'spinner' });
  });

  it('treats a dismissed prompt as success when the permission is now granted', async () => {
    await guide.open('fullDisk');

    fire({ type: 'promptShown' });
    expect(lastState()).toMatchObject({ accessory: 'spinner' });

    statusMock.mockReturnValue('granted');
    fire({ type: 'promptDismissed' });
    vi.advanceTimersByTime(PROMPT_SETTLE_MS);
    expect(lastState()).toMatchObject({ accessory: 'success' });
  });

  it('notices leaving the privacy pane through its window title and returns to it', async () => {
    await guide.open('fullDisk');
    fire({ title: 'Full Disk Access', type: 'windowTitle' });
    vi.advanceTimersByTime(TITLE_SETTLE_MS);

    fire({ title: 'General', type: 'windowTitle' });
    expect(lastState()).toMatchObject({
      accessory: 'settingsIcon',
      actionLabel: 'permissionGuide.offPane.action',
    });

    electronMock.shell.openExternal.mockClear();
    fire({ type: 'action' });
    expect(electronMock.shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );
    expect(lastState()).toMatchObject({ accessory: 'appIcon', draggable: true });

    fire({ title: 'Full Disk Access', type: 'windowTitle' });
    vi.advanceTimersByTime(TITLE_SETTLE_MS);
    fire({ title: 'Wi-Fi', type: 'windowTitle' });
    expect(lastState()).toMatchObject({ accessory: 'settingsIcon' });
    fire({ title: 'Full Disk Access', type: 'windowTitle' });
    expect(lastState()).toMatchObject({ accessory: 'appIcon', draggable: true });
  });

  it('falls back to sidebar clicks when window titles are unreadable', async () => {
    await guide.open('accessibility');
    vi.advanceTimersByTime(TITLE_SETTLE_MS);

    fire({ type: 'navigationClicked' });
    expect(lastState()).toMatchObject({ accessory: 'settingsIcon' });
  });

  it('ignores navigation clicks when window titles are readable', async () => {
    await guide.open('accessibility');
    fire({ title: 'Accessibility', type: 'windowTitle' });
    vi.advanceTimersByTime(TITLE_SETTLE_MS);
    addonMock.showGuide.mockClear();

    fire({ type: 'navigationClicked' });
    expect(addonMock.showGuide).not.toHaveBeenCalled();
  });

  it('ignores a cancelled drag', async () => {
    await guide.open('accessibility');
    addonMock.showGuide.mockClear();

    fire({ dropped: false, type: 'dragEnded' });

    expect(addonMock.showGuide).not.toHaveBeenCalled();
  });

  it('switches to the missing state and reopens Settings from it', async () => {
    await guide.open('fullDisk');
    electronMock.shell.openExternal.mockClear();

    fire({ type: 'settingsLost' });
    expect(lastState()).toMatchObject({ accessory: 'settingsIcon' });

    fire({ type: 'action' });
    expect(electronMock.shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );

    fire({ type: 'settingsFound' });
    expect(lastState()).toMatchObject({ accessory: 'appIcon', draggable: true });
  });

  it('stops polling and hides when the user closes the panel', async () => {
    await guide.open('accessibility');

    fire({ type: 'close' });
    expect(addonMock.hideGuide).toHaveBeenCalledTimes(1);

    statusMock.mockReturnValue('granted');
    addonMock.showGuide.mockClear();
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    expect(addonMock.showGuide).not.toHaveBeenCalled();
    expect(showMainWindow).not.toHaveBeenCalled();
  });
});
