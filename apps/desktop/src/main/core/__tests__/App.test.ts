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

vi.mock('@/env', () => ({
  getDesktopEnv: vi.fn(() => ({ DESKTOP_RENDERER_STATIC: false })),
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
});
