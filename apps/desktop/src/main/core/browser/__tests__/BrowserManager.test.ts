import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App as AppCore } from '../../App';
import { BrowserManager } from '../BrowserManager';

// Use vi.hoisted to define mocks before hoisting
const { MockBrowser, mockAppBrowsers, mockWindowTemplates } = vi.hoisted(() => {
  const createMockBrowserWindow = () => ({
    isMaximized: vi.fn().mockReturnValue(false),
    maximize: vi.fn(),
    minimize: vi.fn(),
    on: vi.fn(),
    unmaximize: vi.fn(),
    webContents: { id: Math.random() },
  });

  const MockBrowser = vi.fn().mockImplementation((options: any) => {
    const browserWindow = createMockBrowserWindow();
    return {
      broadcast: vi.fn(),
      browserWindow,
      close: vi.fn(),
      handleAppThemeChange: vi.fn(),
      hide: vi.fn(),
      identifier: options.identifier,
      loadUrl: vi.fn().mockResolvedValue(undefined),
      options,
      show: vi.fn(),
      webContents: browserWindow.webContents,
    };
  });

  return {
    MockBrowser,
    mockAppBrowsers: {
      app: {
        identifier: 'app',
        keepAlive: true,
        path: '/app',
      },
      settings: {
        identifier: 'settings',
        keepAlive: false,
        path: '/settings',
      },
    },
    mockWindowTemplates: {
      popup: {
        baseIdentifier: 'popup',
        height: 400,
        width: 600,
      },
    },
  };
});

// Mock Browser class
vi.mock('../Browser', () => ({
  default: MockBrowser,
}));

// Mock appBrowsers config
vi.mock('../../../appBrowsers', () => ({
  BrowsersIdentifiers: {
    app: 'app',
    devtools: 'devtools',
  },
  appBrowsers: mockAppBrowsers,
  windowTemplates: mockWindowTemplates,
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

describe('BrowserManager', () => {
  let manager: BrowserManager;
  let mockApp: AppCore;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset MockBrowser
    MockBrowser.mockClear();

    // Create mock App
    mockApp = {} as unknown as AppCore;

    manager = new BrowserManager(mockApp);
  });

  describe('constructor', () => {
    it('should initialize with empty browsers Map', () => {
      expect(manager.browsers.size).toBe(0);
    });

    it('should store app reference', () => {
      expect(manager.app).toBe(mockApp);
    });
  });

  describe('getMainWindow', () => {
    it('should return app window', () => {
      const mainWindow = manager.getMainWindow();

      expect(mainWindow.identifier).toBe('app');
    });
  });

  describe('showMainWindow', () => {
    it('should show the main window', () => {
      manager.showMainWindow();

      const appBrowser = manager.browsers.get('app');
      expect(appBrowser?.show).toHaveBeenCalled();
    });
  });

  describe('retrieveByIdentifier', () => {
    it('should return existing browser', () => {
      // First call creates the browser
      const browser1 = manager.retrieveByIdentifier('app');
      // Second call should return same instance
      const browser2 = manager.retrieveByIdentifier('app');

      expect(browser1).toBe(browser2);
      expect(MockBrowser).toHaveBeenCalledTimes(1);
    });

    it('should create static browser when not exists', () => {
      const browser = manager.retrieveByIdentifier('app');

      expect(MockBrowser).toHaveBeenCalledWith(mockAppBrowsers.app, mockApp);
      expect(browser.identifier).toBe('app');
    });

    it('should throw error for non-static browser that does not exist', () => {
      expect(() => manager.retrieveByIdentifier('non-existent')).toThrow(
        'Browser non-existent not found and is not a static browser',
      );
    });
  });

  describe('createMultiInstanceWindow', () => {
    it('should create window from template', () => {
      const result = manager.createMultiInstanceWindow('popup' as any, '/popup/path');

      expect(result.browser).toBeDefined();
      expect(result.identifier).toMatch(/^popup_/);
      expect(MockBrowser).toHaveBeenCalledWith(
        expect.objectContaining({
          baseIdentifier: 'popup',
          height: 400,
          path: '/popup/path',
          width: 600,
        }),
        mockApp,
      );
    });

    it('should use provided uniqueId', () => {
      const result = manager.createMultiInstanceWindow(
        'popup' as any,
        '/popup/path',
        'my-custom-id',
      );

      expect(result.identifier).toBe('my-custom-id');
    });

    it('should throw error for non-existent template', () => {
      expect(() => manager.createMultiInstanceWindow('nonexistent' as any, '/path')).toThrow(
        'Window template nonexistent not found',
      );
    });

    it('should generate unique identifier when not provided', () => {
      const result1 = manager.createMultiInstanceWindow('popup' as any, '/path1');
      const result2 = manager.createMultiInstanceWindow('popup' as any, '/path2');

      expect(result1.identifier).not.toBe(result2.identifier);
    });
  });

  describe('getWindowsByTemplate', () => {
    it('should return windows matching template prefix', () => {
      manager.createMultiInstanceWindow('popup' as any, '/path1', 'popup_1');
      manager.createMultiInstanceWindow('popup' as any, '/path2', 'popup_2');
      manager.retrieveByIdentifier('app'); // This should not be included

      const popupWindows = manager.getWindowsByTemplate('popup');

      expect(popupWindows).toContain('popup_1');
      expect(popupWindows).toContain('popup_2');
      expect(popupWindows).not.toContain('app');
    });

    it('should return empty array when no matching windows', () => {
      const windows = manager.getWindowsByTemplate('nonexistent');

      expect(windows).toEqual([]);
    });
  });

  describe('closeWindowsByTemplate', () => {
    it('should close all windows matching template', () => {
      const { browser: browser1 } = manager.createMultiInstanceWindow(
        'popup' as any,
        '/path1',
        'popup_1',
      );
      const { browser: browser2 } = manager.createMultiInstanceWindow(
        'popup' as any,
        '/path2',
        'popup_2',
      );

      manager.closeWindowsByTemplate('popup');

      expect(browser1.close).toHaveBeenCalled();
      expect(browser2.close).toHaveBeenCalled();
    });
  });

  describe('initializeBrowsers', () => {
    it('should initialize keepAlive browsers', () => {
      manager.initializeBrowsers();

      // app has keepAlive: true, settings has keepAlive: false
      expect(manager.browsers.has('app')).toBe(true);
      expect(manager.browsers.has('settings')).toBe(false);
    });
  });

  describe('broadcastToAllWindows', () => {
    it('should broadcast to all browsers', () => {
      manager.retrieveByIdentifier('app');
      manager.retrieveByIdentifier('settings');

      manager.broadcastToAllWindows('updateAvailable' as any, { version: '1.0.0' } as any);

      const appBrowser = manager.browsers.get('app');
      const settingsBrowser = manager.browsers.get('settings');

      expect(appBrowser?.broadcast).toHaveBeenCalledWith('updateAvailable', { version: '1.0.0' });
      expect(settingsBrowser?.broadcast).toHaveBeenCalledWith('updateAvailable', {
        version: '1.0.0',
      });
    });
  });

  describe('broadcastToWindow', () => {
    it('should broadcast to specific window', () => {
      manager.retrieveByIdentifier('app');
      manager.retrieveByIdentifier('settings');

      const appBrowser = manager.browsers.get('app');
      const settingsBrowser = manager.browsers.get('settings');

      manager.broadcastToWindow('app', 'updateAvailable' as any, { version: '1.0.0' } as any);

      expect(appBrowser?.broadcast).toHaveBeenCalledWith('updateAvailable', { version: '1.0.0' });
      expect(settingsBrowser?.broadcast).not.toHaveBeenCalled();
    });

    it('should safely handle non-existent window', () => {
      expect(() =>
        manager.broadcastToWindow('nonexistent', 'updateAvailable' as any, {} as any),
      ).not.toThrow();
    });
  });

  describe('redirectToPage', () => {
    it('should load URL and show window', async () => {
      const browser = await manager.redirectToPage('app', 'agent');

      expect(browser.hide).toHaveBeenCalled();
      expect(browser.loadUrl).toHaveBeenCalledWith('/app/agent');
      expect(browser.show).toHaveBeenCalled();
    });

    it('should handle subPath correctly', async () => {
      const browser = await manager.redirectToPage('app', 'settings/profile');

      expect(browser.loadUrl).toHaveBeenCalledWith('/app/settings/profile');
    });

    it('should handle search parameters', async () => {
      const browser = await manager.redirectToPage('app', 'agent', 'id=123');

      expect(browser.loadUrl).toHaveBeenCalledWith('/app/agent?id=123');
    });

    it('should handle search parameters starting with ?', async () => {
      const browser = await manager.redirectToPage('app', undefined, '?id=123');

      expect(browser.loadUrl).toHaveBeenCalledWith('/app?id=123');
    });

    it('should handle no subPath', async () => {
      const browser = await manager.redirectToPage('app');

      expect(browser.loadUrl).toHaveBeenCalledWith('/app');
    });

    it('should throw error on failure', async () => {
      const mockError = new Error('Load failed');
      MockBrowser.mockImplementationOnce((options: any) => ({
        broadcast: vi.fn(),
        browserWindow: { on: vi.fn(), webContents: { id: 1 } },
        close: vi.fn(),
        handleAppThemeChange: vi.fn(),
        hide: vi.fn(),
        identifier: options.identifier,
        loadUrl: vi.fn().mockRejectedValue(mockError),
        options: { path: '/app' },
        show: vi.fn(),
        webContents: { id: 1 },
      }));

      // Clear the browser cache
      manager.browsers.clear();

      await expect(manager.redirectToPage('app', 'agent')).rejects.toThrow('Load failed');
    });
  });

  describe('window operations', () => {
    describe('closeWindow', () => {
      it('should close specified window', () => {
        manager.retrieveByIdentifier('app');

        manager.closeWindow('app');

        const browser = manager.browsers.get('app');
        expect(browser?.close).toHaveBeenCalled();
      });

      it('should safely handle non-existent window', () => {
        expect(() => manager.closeWindow('nonexistent')).not.toThrow();
      });
    });

    describe('minimizeWindow', () => {
      it('should minimize specified window', () => {
        manager.retrieveByIdentifier('app');

        manager.minimizeWindow('app');

        const browser = manager.browsers.get('app');
        expect(browser?.browserWindow.minimize).toHaveBeenCalled();
      });
    });

    describe('maximizeWindow', () => {
      it('should maximize when not maximized', () => {
        manager.retrieveByIdentifier('app');
        const browser = manager.browsers.get('app');
        browser!.browserWindow.isMaximized = vi.fn().mockReturnValue(false);

        manager.maximizeWindow('app');

        expect(browser?.browserWindow.maximize).toHaveBeenCalled();
        expect(browser?.browserWindow.unmaximize).not.toHaveBeenCalled();
      });

      it('should unmaximize when already maximized', () => {
        manager.retrieveByIdentifier('app');
        const browser = manager.browsers.get('app');
        browser!.browserWindow.isMaximized = vi.fn().mockReturnValue(true);

        manager.maximizeWindow('app');

        expect(browser?.browserWindow.unmaximize).toHaveBeenCalled();
        expect(browser?.browserWindow.maximize).not.toHaveBeenCalled();
      });
    });
  });

  describe('getIdentifierByWebContents', () => {
    it('should return identifier for known webContents', () => {
      const browser = manager.retrieveByIdentifier('app');
      const webContents = browser.browserWindow.webContents;

      const identifier = manager.getIdentifierByWebContents(webContents as any);

      expect(identifier).toBe('app');
    });

    it('should return null for unknown webContents', () => {
      const unknownWebContents = { id: 999 };

      const identifier = manager.getIdentifierByWebContents(unknownWebContents as any);

      expect(identifier).toBeNull();
    });
  });

  describe('handleAppThemeChange', () => {
    it('should notify all browsers of theme change', () => {
      manager.retrieveByIdentifier('app');
      manager.retrieveByIdentifier('settings');

      manager.handleAppThemeChange();

      const appBrowser = manager.browsers.get('app');
      const settingsBrowser = manager.browsers.get('settings');

      expect(appBrowser?.handleAppThemeChange).toHaveBeenCalled();
      expect(settingsBrowser?.handleAppThemeChange).toHaveBeenCalled();
    });
  });
});
