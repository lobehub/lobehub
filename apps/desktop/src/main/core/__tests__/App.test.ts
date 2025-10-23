import { app } from 'electron';
import { pathExistsSync, remove } from 'fs-extra';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOCAL_DATABASE_DIR } from '@/const/dir';

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/mock/app/path'),
    getLocale: vi.fn(() => 'en-US'),
    getPath: vi.fn(() => '/mock/user/path'),
    requestSingleInstanceLock: vi.fn(() => true),
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
  },
  nativeTheme: {
    on: vi.fn(),
    shouldUseDarkColors: false,
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
  },
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

// Mock fs-extra module
vi.mock('fs-extra', async () => {
  const actual = await vi.importActual('fs-extra');
  return {
    ...actual,
    pathExistsSync: vi.fn(),
    remove: vi.fn(),
  };
});

// Mock common/routes
vi.mock('~common/routes', () => ({
  findMatchingRoute: vi.fn(),
  extractSubPath: vi.fn(),
}));

// Mock other dependencies
vi.mock('electron-is', () => ({
  macOS: vi.fn(() => false),
  windows: vi.fn(() => false),
}));

vi.mock('fix-path', () => ({
  default: vi.fn(),
}));

vi.mock('@/const/env', () => ({
  isDev: false,
}));

vi.mock('@/const/dir', () => ({
  buildDir: '/mock/build',
  nextStandaloneDir: '/mock/standalone',
  LOCAL_DATABASE_DIR: 'lobehub-local-db',
  appStorageDir: '/mock/storage/path',
  userDataDir: '/mock/user/data',
  DB_SCHEMA_HASH_FILENAME: 'lobehub-local-db-schema-hash',
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
    get: vi.fn((key) => {
      if (key === 'storagePath') return '/mock/storage/path';
      return undefined;
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

vi.mock('@/utils/next-electron-rsc', () => ({
  createHandler: vi.fn(() => ({
    createInterceptor: vi.fn(),
    registerCustomHandler: vi.fn(),
  })),
}));

// Mock controllers and services
vi.mock('../../controllers/*Ctr.ts', () => ({}));
vi.mock('../../services/*Srv.ts', () => ({}));

// Import after mocks are set up
import { App } from '../App';

describe('App - Database Lock Cleanup', () => {
  let appInstance: App;
  let mockLockPath: string;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock glob imports to return empty arrays
    (import.meta as any).glob = vi.fn(() => ({}));

    mockLockPath = join('/mock/storage/path', LOCAL_DATABASE_DIR) + '.lock';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('bootstrap - database lock cleanup', () => {
    it('should remove stale lock file if it exists during bootstrap', async () => {
      // Setup: simulate existing lock file
      vi.mocked(pathExistsSync).mockReturnValue(true);
      vi.mocked(remove).mockResolvedValue(undefined);

      // Create app instance
      appInstance = new App();

      // Call bootstrap which should trigger cleanup
      await appInstance.bootstrap();

      // Verify: lock file check was called
      expect(pathExistsSync).toHaveBeenCalledWith(mockLockPath);

      // Verify: lock file was removed
      expect(remove).toHaveBeenCalledWith(mockLockPath);
    });

    it('should not attempt to remove lock file if it does not exist', async () => {
      // Setup: no lock file exists
      vi.mocked(pathExistsSync).mockReturnValue(false);

      // Create app instance
      appInstance = new App();

      // Call bootstrap
      await appInstance.bootstrap();

      // Verify: lock file check was called
      expect(pathExistsSync).toHaveBeenCalledWith(mockLockPath);

      // Verify: remove was NOT called since file doesn't exist
      expect(remove).not.toHaveBeenCalled();
    });

    it('should continue bootstrap even if lock cleanup fails', async () => {
      // Setup: simulate lock file exists but cleanup fails
      vi.mocked(pathExistsSync).mockReturnValue(true);
      vi.mocked(remove).mockRejectedValue(new Error('Permission denied'));

      // Create app instance
      appInstance = new App();

      // Bootstrap should not throw even if cleanup fails
      await expect(appInstance.bootstrap()).resolves.not.toThrow();

      // Verify: cleanup was attempted
      expect(pathExistsSync).toHaveBeenCalledWith(mockLockPath);
      expect(remove).toHaveBeenCalledWith(mockLockPath);
    });

    it('should clean up lock file before starting IPC server', async () => {
      // Setup
      vi.mocked(pathExistsSync).mockReturnValue(true);
      const callOrder: string[] = [];

      vi.mocked(remove).mockImplementation(async () => {
        callOrder.push('remove');
      });

      // Mock IPC server start to track call order
      const { ElectronIPCServer } = await import('@lobechat/electron-server-ipc');
      const mockStart = vi.fn().mockImplementation(() => {
        callOrder.push('ipcServer.start');
        return Promise.resolve();
      });

      vi.mocked(ElectronIPCServer).mockImplementation(
        () =>
          ({
            start: mockStart,
          }) as any,
      );

      // Create app instance and bootstrap
      appInstance = new App();
      await appInstance.bootstrap();

      // Verify: cleanup happens before IPC server starts
      expect(callOrder).toEqual(['remove', 'ipcServer.start']);
    });
  });

  describe('appStoragePath', () => {
    it('should return storage path from store manager', () => {
      appInstance = new App();

      const storagePath = appInstance.appStoragePath;

      expect(storagePath).toBe('/mock/storage/path');
    });
  });
});
