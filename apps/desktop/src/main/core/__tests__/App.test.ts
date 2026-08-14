import { app as electronApp, ipcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import after mocks are set up
import LocalDatabaseService from '../../services/LocalDatabaseSrv';
import { App } from '../App';

const mockPathExistsSync = vi.fn();

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/mock/app/path'),
    getLocale: vi.fn(() => 'en-US'),
    getPath: vi.fn(() => '/mock/user/path'),
    getVersion: vi.fn(() => '1.2.3'),
    requestSingleInstanceLock: vi.fn(() => true),
    isReady: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    commandLine: {
      appendSwitch: vi.fn(),
    },
    dock: {
      setIcon: vi.fn(),
    },
    exit: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  nativeTheme: {
    on: vi.fn(),
    themeSource: 'system',
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  session: {
    defaultSession: {
      cookies: {
        get: vi.fn(async () => []),
      },
    },
  },
}));

vi.mock('fs-extra', () => ({
  pathExistsSync: (...args: any[]) => mockPathExistsSync(...args),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock common/routes
vi.mock('~common/routes', () => ({
  findMatchingRoute: vi.fn(),
  extractSubPath: vi.fn(),
}));

// Mock other dependencies
vi.mock('@/utils/platform', () => ({
  macOS: vi.fn(() => false),
  windows: vi.fn(() => false),
}));

vi.mock('fix-path', () => ({
  default: vi.fn(),
}));

vi.mock('@/const/env', () => ({
  isDev: false,
}));

vi.mock('@/env', () => ({
  getDesktopEnv: vi.fn(() => ({ DESKTOP_RENDERER_STATIC: false })),
}));

vi.mock('@/const/dir', () => ({
  binDir: '/mock/bin',
  buildDir: '/mock/build',
  rendererDir: '/mock/export/out',
  appStorageDir: '/mock/storage/path',
  userDataDir: '/mock/user/data',
  FILE_STORAGE_DIR: 'file-storage',
  INSTALL_PLUGINS_DIR: 'plugins',
  LOCAL_STORAGE_URL_PREFIX: '/lobe-desktop-file',
}));

vi.mock('@lobechat/electron-server-ipc', () => ({
  ElectronIPCServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock all infrastructure managers
vi.mock('../infrastructure/I18nManager', () => ({
  I18nManager: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../infrastructure/StoreManager', () => ({
  StoreManager: vi.fn().mockImplementation(() => ({
    get: vi.fn((_key, defaultValue) => {
      if (_key === 'storagePath') return '/mock/storage/path';
      return defaultValue;
    }),
    set: vi.fn(),
  })),
}));

vi.mock('../infrastructure/StaticFileServerManager', () => ({
  StaticFileServerManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  })),
}));

vi.mock('../infrastructure/UpdaterManager', () => ({
  UpdaterManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../infrastructure/ProtocolManager', () => ({
  ProtocolManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    processPendingUrls: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../browser/BrowserManager', () => ({
  BrowserManager: vi.fn().mockImplementation(() => ({
    initializeBrowsers: vi.fn(),
    getIdentifierByWebContents: vi.fn(),
    waitForMainWindowFirstFrame: vi.fn(() => new Promise(() => {})),
  })),
}));

vi.mock('../ui/MenuManager', () => ({
  MenuManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
  })),
}));

vi.mock('../ui/ShortcutManager', () => ({
  ShortcutManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
  })),
}));

vi.mock('../ui/TrayManager', () => ({
  TrayManager: vi.fn().mockImplementation(() => ({
    initializeTrays: vi.fn(),
    destroyAll: vi.fn(),
  })),
}));

// Mock controllers and services
vi.mock('../../controllers/*Ctr.ts', () => ({}));
vi.mock('../../services/*Srv.ts', () => ({}));

describe('App', () => {
  let appInstance: App;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExistsSync.mockReset();

    // Mock glob imports to return empty arrays
    import.meta.glob = vi.fn(() => ({}));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('appStoragePath', () => {
    it('should return storage path from store manager', () => {
      appInstance = new App();

      const storagePath = appInstance.appStoragePath;

      expect(storagePath).toBe('/mock/storage/path');
    });
  });

  describe('service lifecycle', () => {
    it('destroys registered services before quitting', () => {
      appInstance = new App();
      const databaseService = appInstance.getService(LocalDatabaseService);
      const destroy = vi.spyOn(databaseService, 'destroy');
      const beforeQuitHandler = vi
        .mocked(electronApp.on)
        .mock.calls.findLast(([event]) => (event as string) === 'before-quit')?.[1] as () => void;

      beforeQuitHandler();

      expect(destroy).toHaveBeenCalledOnce();
    });

    it('prewarms the local database after browser initialization yields to the event loop', async () => {
      appInstance = new App();
      const databaseService = appInstance.getService(LocalDatabaseService);
      const initialize = vi.spyOn(databaseService, 'initialize').mockImplementation(() => {});

      await appInstance.bootstrap();

      expect(appInstance.browserManager.initializeBrowsers).toHaveBeenCalledOnce();
      expect(initialize).not.toHaveBeenCalled();

      await new Promise((resolve) => setImmediate(resolve));

      expect(initialize).toHaveBeenCalledOnce();
      expect(
        vi.mocked(appInstance.browserManager.initializeBrowsers).mock.invocationCallOrder[0],
      ).toBeLessThan(initialize.mock.invocationCallOrder[0]);
    });
  });

  describe('desktop bootstrap identity', () => {
    it('responds through the registered controller without an elided runtime symbol', () => {
      appInstance = new App();
      const listener = vi
        .mocked(ipcMain.on)
        .mock.calls.findLast(
          ([channel]) => channel === 'desktop:get-bootstrap-identity',
        )?.[1] as (event: { returnValue?: unknown }) => void;
      const event: { returnValue?: unknown } = {};

      expect(() => listener(event)).not.toThrow();
      expect(event.returnValue).toEqual({ isIdentityResolved: true });
    });
  });
});
