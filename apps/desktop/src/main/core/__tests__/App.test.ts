import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import after mocks are set up
import { App } from '../App';

const mockPathExistsSync = vi.fn();

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
    on: vi.fn(),
  },
  nativeTheme: {
    on: vi.fn(),
    shouldUseDarkColors: false,
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
  },
  session: {
    defaultSession: {
      cookies: {
        get: vi.fn(async () => []),
      },
    },
  },
}));

// electron-devtools-installer accesses electron.app.getPath at import-time in node env;
// mock it to avoid side effects in unit tests
vi.mock('electron-devtools-installer', () => ({
  REACT_DEVELOPER_TOOLS: 'REACT_DEVELOPER_TOOLS',
  default: vi.fn(),
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
  nextExportDir: '/mock/export/out',
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

  describe('resolveRendererFilePath', () => {
    it('should retry missing .txt requests with variant-prefixed lookup', async () => {
      appInstance = new App();

      // Avoid touching the electron session cookie code path in this unit test
      (appInstance as any).getRouteVariantFromCookies = vi.fn(async () => 'en-US__0__light');

      mockPathExistsSync.mockImplementation((p: string) => {
        // root miss
        if (p === '/mock/export/out/__next._tree.txt') return false;
        // variant hit
        if (p === '/mock/export/out/en-US__0__light/__next._tree.txt') return true;
        return false;
      });

      const resolved = await (appInstance as any).resolveRendererFilePath(
        new URL('app://next/__next._tree.txt'),
      );

      expect(resolved).toBe('/mock/export/out/en-US__0__light/__next._tree.txt');
    });

    it('should keep direct lookup for existing root .txt assets (no variant retry)', async () => {
      appInstance = new App();

      (appInstance as any).getRouteVariantFromCookies = vi.fn(async () => {
        throw new Error('should not be called');
      });

      mockPathExistsSync.mockImplementation((p: string) => {
        if (p === '/mock/export/out/en-US__0__light.txt') return true;
        return false;
      });

      const resolved = await (appInstance as any).resolveRendererFilePath(
        new URL('app://next/en-US__0__light.txt'),
      );

      expect(resolved).toBe('/mock/export/out/en-US__0__light.txt');
    });
  });
});
