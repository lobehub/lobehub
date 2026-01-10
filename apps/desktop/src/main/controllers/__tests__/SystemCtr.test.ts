import { ThemeMode } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import type { IpcContext } from '@/utils/ipc';
import { IpcHandler } from '@/utils/ipc/base';

import SystemController from '../SystemCtr';

const { ipcHandlers, ipcMainHandleMock, readdirSyncMock } = vi.hoisted(() => {
  const handlers = new Map<string, (event: any, ...args: any[]) => any>();
  const handle = vi.fn((channel: string, handler: any) => {
    handlers.set(channel, handler);
  });
  const readdirSync = vi.fn();
  return { ipcHandlers: handlers, ipcMainHandleMock: handle, readdirSyncMock: readdirSync };
});

const invokeIpc = async <T = any>(
  channel: string,
  payload?: any,
  context?: Partial<IpcContext>,
): Promise<T> => {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`IPC handler for ${channel} not found`);

  const fakeEvent = {
    sender: context?.sender ?? ({ id: 'test' } as any),
  };

  if (payload === undefined) {
    return handler(fakeEvent);
  }

  return handler(fakeEvent, payload);
};

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
  app: {
    getLocale: vi.fn(() => 'en-US'),
    getPath: vi.fn((name: string) => `/mock/path/${name}`),
  },
  desktopCapturer: {
    getSources: vi.fn(async () => []),
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 0 })),
  },
  ipcMain: {
    handle: ipcMainHandleMock,
  },
  nativeTheme: {
    on: vi.fn(),
    shouldUseDarkColors: false,
    themeSource: 'system',
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
  systemPreferences: {
    askForMediaAccess: vi.fn(async () => true),
    getMediaAccessStatus: vi.fn(() => 'not-determined'),
    isTrustedAccessibilityClient: vi.fn(() => true),
  },
}));

// Mock electron-is
vi.mock('electron-is', () => ({
  macOS: vi.fn(() => true),
}));

// Mock node:fs for Full Disk Access check
vi.mock('node:fs', () => ({
  default: {
    readdirSync: readdirSyncMock,
  },
  readdirSync: readdirSyncMock,
}));

// Mock node:os for homedir and release
vi.mock('node:os', () => ({
  default: {
    homedir: vi.fn(() => '/Users/testuser'),
    release: vi.fn(() => '23.0.0'), // Darwin 23 = macOS 14 (Sonoma)
  },
  homedir: vi.fn(() => '/Users/testuser'),
  release: vi.fn(() => '23.0.0'),
}));

// Mock node:path
vi.mock('node:path', () => ({
  default: {
    join: vi.fn((...args: string[]) => args.join('/')),
  },
  join: vi.fn((...args: string[]) => args.join('/')),
}));

// Mock browserManager
const mockBrowserManager = {
  broadcastToAllWindows: vi.fn(),
  getMainWindow: vi.fn(() => ({
    browserWindow: {
      isDestroyed: vi.fn(() => false),
      webContents: {
        executeJavaScript: vi.fn(async () => true),
      },
    },
  })),
  handleAppThemeChange: vi.fn(),
};

// Mock storeManager
const mockStoreManager = {
  get: vi.fn(),
  set: vi.fn(),
};

// Mock i18n
const mockI18n = {
  changeLanguage: vi.fn().mockResolvedValue(undefined),
  ns: vi.fn((namespace: string) => (key: string) => `${namespace}.${key}`),
};

const mockApp = {
  appStoragePath: '/mock/storage',
  browserManager: mockBrowserManager,
  i18n: mockI18n,
  storeManager: mockStoreManager,
} as unknown as App;

describe('SystemController', () => {
  let controller: SystemController;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcHandlers.clear();
    ipcMainHandleMock.mockClear();
    (IpcHandler.getInstance() as any).registeredChannels?.clear();
    controller = new SystemController(mockApp);
  });

  describe('getAppState', () => {
    it('should return app state with system info', async () => {
      const result = await invokeIpc('system.getAppState');

      expect(result).toMatchObject({
        arch: expect.any(String),
        platform: expect.any(String),
        userPath: {
          desktop: '/mock/path/desktop',
          documents: '/mock/path/documents',
          downloads: '/mock/path/downloads',
          home: '/mock/path/home',
          music: '/mock/path/music',
          pictures: '/mock/path/pictures',
          userData: '/mock/path/userData',
          videos: '/mock/path/videos',
        },
      });
    });
  });

  describe('accessibility', () => {
    it('should request accessibility access on macOS', async () => {
      const { systemPreferences } = await import('electron');

      await invokeIpc('system.requestAccessibilityAccess');

      expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
    });

    it('should return true on non-macOS when requesting accessibility access', async () => {
      const { macOS } = await import('electron-is');
      const { systemPreferences } = await import('electron');
      vi.mocked(macOS).mockReturnValue(false);

      const result = await invokeIpc('system.requestAccessibilityAccess');

      expect(result).toBe(true);
      expect(systemPreferences.isTrustedAccessibilityClient).not.toHaveBeenCalled();

      // Reset
      vi.mocked(macOS).mockReturnValue(true);
    });
  });

  describe('microphone access', () => {
    it('should ask for microphone access when status is not-determined', async () => {
      const { systemPreferences } = await import('electron');
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('not-determined');

      await invokeIpc('system.requestMicrophoneAccess');

      expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith('microphone');
      expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');

      // Reset
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('not-determined');
    });

    it('should return true immediately if microphone access is already granted', async () => {
      const { shell, systemPreferences } = await import('electron');
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');

      const result = await invokeIpc('system.requestMicrophoneAccess');

      expect(result).toBe(true);
      expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
      expect(shell.openExternal).not.toHaveBeenCalled();

      // Reset
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('not-determined');
    });

    it('should open System Settings if microphone access is denied', async () => {
      const { shell, systemPreferences } = await import('electron');
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied');

      const result = await invokeIpc('system.requestMicrophoneAccess');

      expect(result).toBe(false);
      expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      );

      // Reset
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('not-determined');
    });

    it('should return true on non-macOS', async () => {
      const { macOS } = await import('electron-is');
      const { shell, systemPreferences } = await import('electron');
      vi.mocked(macOS).mockReturnValue(false);

      const result = await invokeIpc('system.requestMicrophoneAccess');

      expect(result).toBe(true);
      expect(systemPreferences.getMediaAccessStatus).not.toHaveBeenCalled();
      expect(shell.openExternal).not.toHaveBeenCalled();

      // Reset
      vi.mocked(macOS).mockReturnValue(true);
    });
  });

  describe('screen recording', () => {
    it('should use desktopCapturer and getDisplayMedia to trigger TCC and open System Settings on macOS', async () => {
      const { desktopCapturer, shell, systemPreferences } = await import('electron');

      const result = await invokeIpc('system.requestScreenAccess');

      expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith('screen');
      expect(desktopCapturer.getSources).toHaveBeenCalledWith({
        fetchWindowIcons: true,
        thumbnailSize: { height: 144, width: 256 },
        types: ['screen', 'window'],
      });
      expect(mockBrowserManager.getMainWindow).toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
      expect(typeof result).toBe('boolean');
    });

    it('should return true immediately if screen access is already granted', async () => {
      const { desktopCapturer, shell, systemPreferences } = await import('electron');
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');

      const result = await invokeIpc('system.requestScreenAccess');

      expect(result).toBe(true);
      expect(desktopCapturer.getSources).not.toHaveBeenCalled();
      expect(shell.openExternal).not.toHaveBeenCalled();

      // Reset
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('not-determined');
    });

    it('should return true on non-macOS and not open settings', async () => {
      const { macOS } = await import('electron-is');
      const { desktopCapturer, shell } = await import('electron');
      vi.mocked(macOS).mockReturnValue(false);

      const result = await invokeIpc('system.requestScreenAccess');

      expect(result).toBe(true);
      expect(desktopCapturer.getSources).not.toHaveBeenCalled();
      expect(shell.openExternal).not.toHaveBeenCalled();

      // Reset
      vi.mocked(macOS).mockReturnValue(true);
    });
  });

  describe('full disk access', () => {
    it('should return true when Full Disk Access is granted (can read protected directory)', async () => {
      readdirSyncMock.mockReturnValue(['file1', 'file2']);

      const result = await invokeIpc('system.getFullDiskAccessStatus');

      expect(result).toBe(true);
      // On macOS 14 (Darwin 23), should check com.apple.stocks
      expect(readdirSyncMock).toHaveBeenCalledWith(
        '/Users/testuser/Library/Containers/com.apple.stocks',
      );
    });

    it('should return false when Full Disk Access is not granted (cannot read protected directory)', async () => {
      readdirSyncMock.mockImplementation(() => {
        throw new Error('EPERM: operation not permitted');
      });

      const result = await invokeIpc('system.getFullDiskAccessStatus');

      expect(result).toBe(false);
    });

    it('should return true on non-macOS', async () => {
      const { macOS } = await import('electron-is');
      vi.mocked(macOS).mockReturnValue(false);

      const result = await invokeIpc('system.getFullDiskAccessStatus');

      expect(result).toBe(true);

      // Reset
      vi.mocked(macOS).mockReturnValue(true);
    });

    it('should try to open Full Disk Access settings with fallbacks', async () => {
      const { shell } = await import('electron');
      vi.mocked(shell.openExternal)
        .mockRejectedValueOnce(new Error('fail first'))
        .mockResolvedValueOnce(undefined);

      await invokeIpc('system.openFullDiskAccessSettings');

      expect(shell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
      );
      expect(shell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      );
    });

    it('should open fallback Privacy settings if all candidates fail', async () => {
      const { shell } = await import('electron');
      vi.mocked(shell.openExternal)
        .mockRejectedValueOnce(new Error('fail first'))
        .mockRejectedValueOnce(new Error('fail second'))
        .mockResolvedValueOnce(undefined);

      await invokeIpc('system.openFullDiskAccessSettings');

      expect(shell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy',
      );
    });

    it('should return granted if Full Disk Access is already granted', async () => {
      readdirSyncMock.mockReturnValue(['file1', 'file2']);

      const result = await invokeIpc('system.promptFullDiskAccessIfNotGranted');

      expect(result).toBe('granted');
    });

    it('should show dialog and open settings when user clicks Open Settings', async () => {
      const { dialog, shell } = await import('electron');
      readdirSyncMock.mockImplementation(() => {
        throw new Error('EPERM: operation not permitted');
      });
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0 } as any);

      const result = await invokeIpc('system.promptFullDiskAccessIfNotGranted');

      expect(result).toBe('opened_settings');
      expect(dialog.showMessageBox).toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalled();
    });

    it('should return skipped when user clicks Later', async () => {
      const { dialog, shell } = await import('electron');
      readdirSyncMock.mockImplementation(() => {
        throw new Error('EPERM: operation not permitted');
      });
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1 } as any);
      vi.mocked(shell.openExternal).mockClear();

      const result = await invokeIpc('system.promptFullDiskAccessIfNotGranted');

      expect(result).toBe('skipped');
      expect(dialog.showMessageBox).toHaveBeenCalled();
      // Should not open settings when user skips
      expect(shell.openExternal).not.toHaveBeenCalled();
    });
  });

  describe('openExternalLink', () => {
    it('should open external link', async () => {
      const { shell } = await import('electron');

      await invokeIpc('system.openExternalLink', 'https://example.com');

      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    });
  });

  describe('updateLocale', () => {
    it('should update locale and broadcast change', async () => {
      const result = await invokeIpc('system.updateLocale', 'zh-CN');

      expect(mockStoreManager.set).toHaveBeenCalledWith('locale', 'zh-CN');
      expect(mockI18n.changeLanguage).toHaveBeenCalledWith('zh-CN');
      expect(mockBrowserManager.broadcastToAllWindows).toHaveBeenCalledWith('localeChanged', {
        locale: 'zh-CN',
      });
      expect(result).toEqual({ success: true });
    });

    it('should use system locale when set to auto', async () => {
      await invokeIpc('system.updateLocale', 'auto');

      expect(mockI18n.changeLanguage).toHaveBeenCalledWith('en-US');
    });
  });

  describe('updateThemeModeHandler', () => {
    it('should update theme mode and broadcast change', async () => {
      const themeMode: ThemeMode = 'dark';

      await invokeIpc('system.updateThemeModeHandler', themeMode);

      expect(mockStoreManager.set).toHaveBeenCalledWith('themeMode', 'dark');
      expect(mockBrowserManager.broadcastToAllWindows).toHaveBeenCalledWith('themeChanged', {
        themeMode: 'dark',
      });
      expect(mockBrowserManager.handleAppThemeChange).toHaveBeenCalled();
    });
  });

  describe('afterAppReady', () => {
    it('should initialize system theme listener', async () => {
      const { nativeTheme } = await import('electron');

      controller.afterAppReady();

      expect(nativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function));
    });

    it('should not initialize listener twice', async () => {
      const { nativeTheme } = await import('electron');

      controller.afterAppReady();
      controller.afterAppReady();

      // Should only be called once
      expect(nativeTheme.on).toHaveBeenCalledTimes(1);
    });

    it('should broadcast system theme change when theme updates', async () => {
      const { nativeTheme } = await import('electron');

      controller.afterAppReady();

      // Get the callback that was registered
      const callback = vi.mocked(nativeTheme.on).mock.calls[0][1] as () => void;

      // Simulate theme change to dark
      Object.defineProperty(nativeTheme, 'shouldUseDarkColors', { value: true });
      callback();

      expect(mockBrowserManager.broadcastToAllWindows).toHaveBeenCalledWith('systemThemeChanged', {
        themeMode: 'dark',
      });

      // Reset
      Object.defineProperty(nativeTheme, 'shouldUseDarkColors', { value: false });
    });
  });
});
