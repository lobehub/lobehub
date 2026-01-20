import { ThemeMode } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import type { IpcContext } from '@/utils/ipc';
import { IpcHandler } from '@/utils/ipc/base';
import { __resetMacPermissionsModuleCache, __setMacPermissionsModule } from '@/utils/permissions';

import SystemController from '../SystemCtr';

const { ipcHandlers, ipcMainHandleMock, permissionsMock } = vi.hoisted(() => {
  const handlers = new Map<string, (event: any, ...args: any[]) => any>();
  const handle = vi.fn((channel: string, handler: any) => {
    handlers.set(channel, handler);
  });
  const permissions = {
    askForAccessibilityAccess: vi.fn(() => undefined),
    askForCameraAccess: vi.fn(() => Promise.resolve('authorized')),
    askForFullDiskAccess: vi.fn(() => undefined),
    askForMicrophoneAccess: vi.fn(() => Promise.resolve('authorized')),
    askForScreenCaptureAccess: vi.fn(() => undefined),
    getAuthStatus: vi.fn(() => 'authorized'),
  };
  return { ipcHandlers: handlers, ipcMainHandleMock: handle, permissionsMock: permissions };
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

// Mock node-mac-permissions
vi.mock('node-mac-permissions', () => permissionsMock);

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
    // Reset and inject mock permissions module for testing
    __resetMacPermissionsModuleCache();
    __setMacPermissionsModule(permissionsMock as any);
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
      permissionsMock.getAuthStatus.mockReturnValue('authorized');

      const result = await invokeIpc('system.requestAccessibilityAccess');

      expect(permissionsMock.askForAccessibilityAccess).toHaveBeenCalled();
      expect(permissionsMock.getAuthStatus).toHaveBeenCalledWith('accessibility');
      expect(result).toBe(true);
    });

    it('should return true on non-macOS when requesting accessibility access', async () => {
      const { macOS } = await import('electron-is');
      vi.mocked(macOS).mockReturnValue(false);
      // Clear the injected module to simulate non-macOS behavior
      __setMacPermissionsModule(null);

      const result = await invokeIpc('system.requestAccessibilityAccess');

      expect(result).toBe(true);
      expect(permissionsMock.askForAccessibilityAccess).not.toHaveBeenCalled();

      // Reset
      vi.mocked(macOS).mockReturnValue(true);
      __setMacPermissionsModule(permissionsMock as any);
    });
  });

  describe('microphone access', () => {
    it('should ask for microphone access when status is not-determined', async () => {
      permissionsMock.getAuthStatus.mockReturnValue('not determined');
      permissionsMock.askForMicrophoneAccess.mockResolvedValue('authorized');

      const result = await invokeIpc('system.requestMicrophoneAccess');

      expect(permissionsMock.getAuthStatus).toHaveBeenCalledWith('microphone');
      expect(permissionsMock.askForMicrophoneAccess).toHaveBeenCalled();
      expect(result).toBe(true);

      // Reset
      permissionsMock.getAuthStatus.mockReturnValue('authorized');
    });

    it('should return true immediately if microphone access is already granted', async () => {
      const { shell } = await import('electron');
      permissionsMock.getAuthStatus.mockReturnValue('authorized');

      const result = await invokeIpc('system.requestMicrophoneAccess');

      expect(result).toBe(true);
      expect(permissionsMock.askForMicrophoneAccess).not.toHaveBeenCalled();
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('should open System Settings if microphone access is denied', async () => {
      const { shell } = await import('electron');
      permissionsMock.getAuthStatus.mockReturnValue('denied');

      const result = await invokeIpc('system.requestMicrophoneAccess');

      expect(result).toBe(false);
      expect(permissionsMock.askForMicrophoneAccess).not.toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      );

      // Reset
      permissionsMock.getAuthStatus.mockReturnValue('authorized');
    });

    it('should return true on non-macOS', async () => {
      const { macOS } = await import('electron-is');
      const { shell } = await import('electron');
      vi.mocked(macOS).mockReturnValue(false);
      // Clear the injected module to simulate non-macOS behavior
      __setMacPermissionsModule(null);

      const result = await invokeIpc('system.requestMicrophoneAccess');

      expect(result).toBe(true);
      expect(permissionsMock.getAuthStatus).not.toHaveBeenCalled();
      expect(shell.openExternal).not.toHaveBeenCalled();

      // Reset
      vi.mocked(macOS).mockReturnValue(true);
      __setMacPermissionsModule(permissionsMock as any);
    });
  });

  describe('screen recording', () => {
    it('should request screen capture access on macOS', async () => {
      permissionsMock.getAuthStatus.mockReturnValue('not determined');

      const result = await invokeIpc('system.requestScreenAccess');

      expect(permissionsMock.getAuthStatus).toHaveBeenCalledWith('screen');
      expect(permissionsMock.askForScreenCaptureAccess).toHaveBeenCalled();
      expect(typeof result).toBe('boolean');
    });

    it('should return true immediately if screen access is already granted', async () => {
      permissionsMock.getAuthStatus.mockReturnValue('authorized');

      const result = await invokeIpc('system.requestScreenAccess');

      expect(result).toBe(true);
      expect(permissionsMock.askForScreenCaptureAccess).not.toHaveBeenCalled();
    });

    it('should return true on non-macOS and not open settings', async () => {
      const { macOS } = await import('electron-is');
      vi.mocked(macOS).mockReturnValue(false);

      const result = await invokeIpc('system.requestScreenAccess');

      expect(result).toBe(true);
      expect(permissionsMock.askForScreenCaptureAccess).not.toHaveBeenCalled();

      // Reset
      vi.mocked(macOS).mockReturnValue(true);
    });
  });

  describe('full disk access', () => {
    it('should return true when Full Disk Access is granted', async () => {
      permissionsMock.getAuthStatus.mockReturnValue('authorized');

      const result = await invokeIpc('system.getFullDiskAccessStatus');

      expect(result).toBe(true);
      expect(permissionsMock.getAuthStatus).toHaveBeenCalledWith('full-disk-access');
    });

    it('should return false when Full Disk Access is not granted', async () => {
      permissionsMock.getAuthStatus.mockReturnValue('denied');

      const result = await invokeIpc('system.getFullDiskAccessStatus');

      expect(result).toBe(false);

      // Reset
      permissionsMock.getAuthStatus.mockReturnValue('authorized');
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
      permissionsMock.getAuthStatus.mockReturnValue('authorized');

      const result = await invokeIpc('system.promptFullDiskAccessIfNotGranted');

      expect(result).toBe('granted');
    });

    it('should show dialog and open settings when user clicks Open Settings', async () => {
      const { dialog, shell } = await import('electron');
      permissionsMock.getAuthStatus.mockReturnValue('denied');
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0 } as any);

      const result = await invokeIpc('system.promptFullDiskAccessIfNotGranted');

      expect(result).toBe('opened_settings');
      expect(dialog.showMessageBox).toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalled();

      // Reset
      permissionsMock.getAuthStatus.mockReturnValue('authorized');
    });

    it('should return skipped when user clicks Later', async () => {
      const { dialog, shell } = await import('electron');
      permissionsMock.getAuthStatus.mockReturnValue('denied');
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1 } as any);
      vi.mocked(shell.openExternal).mockClear();

      const result = await invokeIpc('system.promptFullDiskAccessIfNotGranted');

      expect(result).toBe('skipped');
      expect(dialog.showMessageBox).toHaveBeenCalled();
      // Should not open settings when user skips
      expect(shell.openExternal).not.toHaveBeenCalled();

      // Reset
      permissionsMock.getAuthStatus.mockReturnValue('authorized');
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
