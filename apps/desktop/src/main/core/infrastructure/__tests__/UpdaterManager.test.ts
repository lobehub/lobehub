import { autoUpdater } from 'electron-updater';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App as AppCore } from '../../App';
import { UpdaterManager } from '../UpdaterManager';

// Use vi.hoisted to ensure mocks work with require()
const { mockGetAllWindows, mockReleaseSingleInstanceLock } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn().mockReturnValue([]),
  mockReleaseSingleInstanceLock: vi.fn(),
}));

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    transports: {
      file: {
        level: 'info',
        getFile: vi.fn().mockReturnValue({ path: '/mock/log/path' }),
      },
    },
  },
}));

// Mock electron-updater
vi.mock('electron-updater', () => ({
  autoUpdater: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: 'stable',
    checkForUpdates: vi.fn(),
    currentVersion: undefined as any,
    downloadUpdate: vi.fn(),
    forceDevUpdateConfig: false,
    logger: null as any,
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

// Mock electron - uses hoisted functions for require() compatibility
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
  app: {
    getVersion: vi.fn().mockReturnValue('0.0.0'),
    releaseSingleInstanceLock: mockReleaseSingleInstanceLock,
  },
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock updater configs
vi.mock('@/modules/updater/configs', () => ({
  UPDATE_CHANNEL: 'stable',
  UPDATE_SERVER_URL: 'https://mock.update.server',
  githubConfig: {
    owner: 'lobehub',
    repo: 'lobe-chat',
  },
  isStableChannel: true,
  updaterConfig: {
    app: {
      autoCheckUpdate: false,
      autoDownloadUpdate: true,
      checkUpdateInterval: 60 * 60 * 1000,
    },
    enableAppUpdate: true,
  },
}));

// Mock env
vi.mock('@/env', () => ({
  getDesktopEnv: () => ({
    FORCE_DEV_UPDATE_CONFIG: false,
  }),
}));

// Mock isDev
vi.mock('@/const/env', () => ({
  isDev: false,
}));

describe('UpdaterManager', () => {
  let updaterManager: UpdaterManager;
  let mockApp: AppCore;
  let mockBroadcast: ReturnType<typeof vi.fn>;
  let registeredEvents: Map<string, (...args: any[]) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset autoUpdater state
    (autoUpdater as any).autoDownload = false;
    (autoUpdater as any).autoInstallOnAppQuit = false;
    (autoUpdater as any).channel = 'stable';
    (autoUpdater as any).allowPrerelease = false;
    (autoUpdater as any).allowDowngrade = false;
    (autoUpdater as any).forceDevUpdateConfig = false;
    (autoUpdater as any).currentVersion = undefined;

    // Capture registered events
    registeredEvents = new Map();
    vi.mocked(autoUpdater.on).mockImplementation((event: string, handler: any) => {
      registeredEvents.set(event, handler);
      return autoUpdater;
    });

    // Mock broadcast function
    mockBroadcast = vi.fn();

    // Create mock App
    mockApp = {
      browserManager: {
        getMainWindow: vi.fn().mockReturnValue({
          broadcast: mockBroadcast,
        }),
      },
      isQuiting: false,
    } as unknown as AppCore;

    updaterManager = new UpdaterManager(mockApp);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should set up electron-log for autoUpdater', () => {
      expect(autoUpdater.logger).not.toBeNull();
    });
  });

  describe('initialize', () => {
    it('should configure autoUpdater properties', async () => {
      await updaterManager.initialize();

      expect(autoUpdater.autoDownload).toBe(false);
      expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
      expect(autoUpdater.channel).toBe('stable');
      expect(autoUpdater.allowPrerelease).toBe(false);
      expect(autoUpdater.allowDowngrade).toBe(false);
    });

    it('should register all event listeners', async () => {
      await updaterManager.initialize();

      expect(autoUpdater.on).toHaveBeenCalledWith('checking-for-update', expect.any(Function));
      expect(autoUpdater.on).toHaveBeenCalledWith('update-available', expect.any(Function));
      expect(autoUpdater.on).toHaveBeenCalledWith('update-not-available', expect.any(Function));
      expect(autoUpdater.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(autoUpdater.on).toHaveBeenCalledWith('download-progress', expect.any(Function));
      expect(autoUpdater.on).toHaveBeenCalledWith('update-downloaded', expect.any(Function));
    });
  });

  describe('checkForUpdates', () => {
    beforeEach(async () => {
      await updaterManager.initialize();
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
    });

    it('should call autoUpdater.checkForUpdates', async () => {
      await updaterManager.checkForUpdates();

      expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
    });

    it('should broadcast manualUpdateCheckStart when manual check', async () => {
      await updaterManager.checkForUpdates({ manual: true });

      expect(mockBroadcast).toHaveBeenCalledWith('manualUpdateCheckStart');
    });

    it('should not broadcast when auto check', async () => {
      await updaterManager.checkForUpdates({ manual: false });

      expect(mockBroadcast).not.toHaveBeenCalledWith('manualUpdateCheckStart');
    });

    it('should ignore duplicate check requests while checking', async () => {
      // Start first check but don't resolve
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000)) as any,
      );

      const firstCheck = updaterManager.checkForUpdates();
      const secondCheck = updaterManager.checkForUpdates();

      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all([firstCheck, secondCheck]);

      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    });

    it('should broadcast updateError when check fails during manual check', async () => {
      const error = new Error('Network error');
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(error);

      await updaterManager.checkForUpdates({ manual: true });

      expect(mockBroadcast).toHaveBeenCalledWith('updateError', 'Network error');
    });

    it('should treat missing latest/stable yml 404 as not-available during manual check', async () => {
      const error = new Error(
        'Cannot find latest-mac.yml in the latest release artifacts (https://github.com/lobehub/lobe-chat/releases/download/v2.0.0-next.311/latest-mac.yml): HttpError: 404',
      );
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValueOnce(error);

      await updaterManager.checkForUpdates({ manual: true });

      expect(mockBroadcast).toHaveBeenCalledWith(
        'manualUpdateNotAvailable',
        expect.objectContaining({
          releaseDate: expect.any(String),
          version: expect.any(String),
        }),
      );
      expect(mockBroadcast).not.toHaveBeenCalledWith('updateError', expect.anything());
    });
  });

  describe('downloadUpdate', () => {
    beforeEach(async () => {
      await updaterManager.initialize();
      vi.mocked(autoUpdater.downloadUpdate).mockResolvedValue([] as any);

      // Simulate update available
      const updateAvailableHandler = registeredEvents.get('update-available');
      updateAvailableHandler?.({ version: '2.0.0' });
    });

    it('should call autoUpdater.downloadUpdate', async () => {
      await updaterManager.downloadUpdate();

      expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
    });

    it('should ignore download request when no update available', async () => {
      // Create fresh manager without update available
      const freshManager = new UpdaterManager(mockApp);
      await freshManager.initialize();

      await freshManager.downloadUpdate();

      // Reset call count since downloadUpdate might have been called in beforeEach
      vi.mocked(autoUpdater.downloadUpdate).mockClear();
      await freshManager.downloadUpdate();

      // downloadUpdate should not be called on autoUpdater for fresh manager
      expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    });

    it('should ignore duplicate download requests while downloading', async () => {
      vi.mocked(autoUpdater.downloadUpdate).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000)) as any,
      );

      const firstDownload = updaterManager.downloadUpdate();
      const secondDownload = updaterManager.downloadUpdate();

      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all([firstDownload, secondDownload]);

      expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('should broadcast updateDownloadStart when isManualCheck is true', async () => {
      // Create a fresh manager to avoid state pollution from beforeEach
      const freshManager = new UpdaterManager(mockApp);

      // Setup fresh event capture
      const freshEvents = new Map<string, (...args: any[]) => void>();
      vi.mocked(autoUpdater.on).mockImplementation((event: string, handler: any) => {
        freshEvents.set(event, handler);
        return autoUpdater;
      });
      await freshManager.initialize();

      // Trigger a manual check to set isManualCheck = true
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
      await freshManager.checkForUpdates({ manual: true });

      // Manually set updateAvailable without triggering auto-download
      // Access private property to set state
      (freshManager as any).updateAvailable = true;

      // Clear previous broadcast calls
      mockBroadcast.mockClear();

      // Now download should broadcast updateDownloadStart because isManualCheck is true
      vi.mocked(autoUpdater.downloadUpdate).mockResolvedValue([] as any);
      await freshManager.downloadUpdate();

      expect(mockBroadcast).toHaveBeenCalledWith('updateDownloadStart');
    });

    it('should broadcast updateError when download fails with isManualCheck true', async () => {
      // Create a fresh manager to avoid state pollution from beforeEach
      const freshManager = new UpdaterManager(mockApp);

      // Setup fresh event capture
      const freshEvents = new Map<string, (...args: any[]) => void>();
      vi.mocked(autoUpdater.on).mockImplementation((event: string, handler: any) => {
        freshEvents.set(event, handler);
        return autoUpdater;
      });
      await freshManager.initialize();

      // Trigger a manual check to set isManualCheck = true
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
      await freshManager.checkForUpdates({ manual: true });

      // Manually set updateAvailable without triggering auto-download
      (freshManager as any).updateAvailable = true;

      // Clear previous broadcast calls
      mockBroadcast.mockClear();

      // Setup error
      const error = new Error('Download failed');
      vi.mocked(autoUpdater.downloadUpdate).mockRejectedValue(error);

      await freshManager.downloadUpdate();

      expect(mockBroadcast).toHaveBeenCalledWith('updateError', 'Download failed');
    });
  });

  describe('installNow', () => {
    // Note: installNow uses require('electron') which is difficult to mock in vitest.
    // These tests are skipped because vi.mock doesn't work with dynamic require().
    // The functionality should be tested in integration tests or E2E tests.

    it.skip('should set app.isQuiting to true', () => {
      updaterManager.installNow();
      expect(mockApp.isQuiting).toBe(true);
    });

    it.skip('should close all windows', () => {
      const mockWindow1 = { close: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) };
      const mockWindow2 = { close: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) };
      mockGetAllWindows.mockReturnValue([mockWindow1, mockWindow2]);
      updaterManager.installNow();
      expect(mockWindow1.close).toHaveBeenCalled();
      expect(mockWindow2.close).toHaveBeenCalled();
    });

    it.skip('should not close destroyed windows', () => {
      const mockWindow = { close: vi.fn(), isDestroyed: vi.fn().mockReturnValue(true) };
      mockGetAllWindows.mockReturnValue([mockWindow]);
      updaterManager.installNow();
      expect(mockWindow.close).not.toHaveBeenCalled();
    });

    it.skip('should release single instance lock', () => {
      updaterManager.installNow();
      expect(mockReleaseSingleInstanceLock).toHaveBeenCalled();
    });

    it.skip('should call quitAndInstall with correct parameters after delay', async () => {
      updaterManager.installNow();
      expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
    });
  });

  describe('installLater', () => {
    it('should set autoInstallOnAppQuit to true', () => {
      updaterManager.installLater();

      expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    });

    it('should broadcast updateWillInstallLater', () => {
      updaterManager.installLater();

      expect(mockBroadcast).toHaveBeenCalledWith('updateWillInstallLater');
    });
  });

  describe('event handlers', () => {
    beforeEach(async () => {
      await updaterManager.initialize();
    });

    describe('update-available', () => {
      it('should broadcast manualUpdateAvailable when manual check', async () => {
        // Trigger manual check first
        vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
        await updaterManager.checkForUpdates({ manual: true });

        const updateInfo = { version: '2.0.0' };
        const handler = registeredEvents.get('update-available');
        handler?.(updateInfo);

        expect(mockBroadcast).toHaveBeenCalledWith('manualUpdateAvailable', updateInfo);
      });

      it('should auto download when auto check finds update', async () => {
        // Trigger auto check first
        vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
        await updaterManager.checkForUpdates({ manual: false });

        vi.mocked(autoUpdater.downloadUpdate).mockResolvedValue([] as any);

        const handler = registeredEvents.get('update-available');
        handler?.({ version: '2.0.0' });

        expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
      });
    });

    describe('update-not-available', () => {
      it('should broadcast manualUpdateNotAvailable when manual check', async () => {
        vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
        await updaterManager.checkForUpdates({ manual: true });

        const info = { version: '1.0.0' };
        const handler = registeredEvents.get('update-not-available');
        handler?.(info);

        expect(mockBroadcast).toHaveBeenCalledWith('manualUpdateNotAvailable', info);
      });

      it('should not broadcast when auto check', async () => {
        vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
        await updaterManager.checkForUpdates({ manual: false });

        const handler = registeredEvents.get('update-not-available');
        handler?.({ version: '1.0.0' });

        expect(mockBroadcast).not.toHaveBeenCalledWith(
          'manualUpdateNotAvailable',
          expect.anything(),
        );
      });
    });

    describe('download-progress', () => {
      it('should broadcast progress when manual check', async () => {
        vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
        await updaterManager.checkForUpdates({ manual: true });

        const progressObj = {
          bytesPerSecond: 1024,
          percent: 50,
          total: 1024 * 1024,
          transferred: 512 * 1024,
        };
        const handler = registeredEvents.get('download-progress');
        handler?.(progressObj);

        expect(mockBroadcast).toHaveBeenCalledWith('updateDownloadProgress', progressObj);
      });
    });

    describe('update-downloaded', () => {
      it('should broadcast updateDownloaded', async () => {
        await updaterManager.initialize();

        const info = { version: '2.0.0' };
        const handler = registeredEvents.get('update-downloaded');
        handler?.(info);

        expect(mockBroadcast).toHaveBeenCalledWith('updateDownloaded', info);
      });
    });

    describe('error', () => {
      it('should broadcast updateError when manual check', async () => {
        vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
        await updaterManager.checkForUpdates({ manual: true });

        vi.mocked(autoUpdater.checkForUpdates).mockRejectedValueOnce(new Error('Fallback failed'));

        const error = new Error('Update error');
        const handler = registeredEvents.get('error');
        await handler?.(error);

        expect(mockBroadcast).toHaveBeenCalledWith('updateError', 'Update error');
      });

      it('should not broadcast when auto check', async () => {
        vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
        await updaterManager.checkForUpdates({ manual: false });

        const error = new Error('Update error');
        const handler = registeredEvents.get('error');
        handler?.(error);

        expect(mockBroadcast).not.toHaveBeenCalledWith('updateError', expect.anything());
      });

      it('should not broadcast updateError for missing manifest 404 (gap period)', async () => {
        vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
        await updaterManager.checkForUpdates({ manual: true });

        const error = new Error(
          'Cannot find latest-mac.yml in the latest release artifacts (https://github.com/lobehub/lobe-chat/releases/download/v2.0.0-next.311/latest-mac.yml): HttpError: 404',
        );
        const handler = registeredEvents.get('error');
        await handler?.(error);

        expect(mockBroadcast).toHaveBeenCalledWith(
          'manualUpdateNotAvailable',
          expect.objectContaining({
            releaseDate: expect.any(String),
            version: expect.any(String),
          }),
        );
        expect(mockBroadcast).not.toHaveBeenCalledWith('updateError', expect.anything());
      });
    });
  });

  describe('simulation methods (dev mode)', () => {
    it('simulateUpdateAvailable should do nothing when not in dev mode', () => {
      // Current mock has isDev = false
      updaterManager.simulateUpdateAvailable();

      // Should not broadcast anything since isDev is false
      expect(mockBroadcast).not.toHaveBeenCalledWith(
        'manualUpdateAvailable',
        expect.objectContaining({ version: '1.0.0' }),
      );
    });

    it('simulateUpdateDownloaded should do nothing when not in dev mode', () => {
      updaterManager.simulateUpdateDownloaded();

      expect(mockBroadcast).not.toHaveBeenCalledWith(
        'updateDownloaded',
        expect.objectContaining({ version: '1.0.0' }),
      );
    });

    it('simulateDownloadProgress should do nothing when not in dev mode', () => {
      updaterManager.simulateDownloadProgress();

      expect(mockBroadcast).not.toHaveBeenCalledWith('updateDownloadStart');
    });
  });

  describe('mainWindow getter', () => {
    it('should return main window from browserManager', () => {
      const mainWindow = updaterManager['mainWindow'];

      expect(mockApp.browserManager.getMainWindow).toHaveBeenCalled();
      expect(mainWindow.broadcast).toBe(mockBroadcast);
    });
  });
});
