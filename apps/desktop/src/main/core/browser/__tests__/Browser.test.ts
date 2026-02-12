import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App as AppCore } from '../../App';
import Browser, { BrowserWindowOpts } from '../Browser';

// Use vi.hoisted to define mocks before hoisting
const { mockBrowserWindow, mockNativeTheme, mockIpcMain, mockScreen, MockBrowserWindow } =
  vi.hoisted(() => {
    const mockBrowserWindow = {
      center: vi.fn(),
      close: vi.fn(),
      focus: vi.fn(),
      getBounds: vi.fn().mockReturnValue({ height: 600, width: 800, x: 0, y: 0 }),
      getContentBounds: vi.fn().mockReturnValue({ height: 600, width: 800 }),
      hide: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      isFocused: vi.fn().mockReturnValue(true),
      isFullScreen: vi.fn().mockReturnValue(false),
      isMaximized: vi.fn().mockReturnValue(false),
      isVisible: vi.fn().mockReturnValue(true),
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn(),
      minimize: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      setBackgroundColor: vi.fn(),
      setBounds: vi.fn(),
      setFullScreen: vi.fn(),
      setPosition: vi.fn(),
      setTitleBarOverlay: vi.fn(),
      show: vi.fn(),
      unmaximize: vi.fn(),
      webContents: {
        openDevTools: vi.fn(),
        send: vi.fn(),
        session: {
          webRequest: {
            onBeforeSendHeaders: vi.fn(),
            onHeadersReceived: vi.fn(),
          },
        },
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
    };

    return {
      MockBrowserWindow: vi.fn().mockImplementation(() => mockBrowserWindow),
      mockBrowserWindow,
      mockIpcMain: {
        handle: vi.fn(),
        removeHandler: vi.fn(),
      },
      mockNativeTheme: {
        off: vi.fn(),
        on: vi.fn(),
        shouldUseDarkColors: false,
        themeSource: 'system',
      },
      mockScreen: {
        getDisplayMatching: vi.fn().mockReturnValue({
          workArea: { height: 1080, width: 1920, x: 0, y: 0 },
        }),
        getDisplayNearestPoint: vi.fn().mockReturnValue({
          workArea: { height: 1080, width: 1920, x: 0, y: 0 },
        }),
        getPrimaryDisplay: vi.fn().mockReturnValue({
          workArea: { height: 1080, width: 1920, x: 0, y: 0 },
        }),
      },
    };
  });

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  ipcMain: mockIpcMain,
  nativeTheme: mockNativeTheme,
  screen: mockScreen,
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

// Mock constants
vi.mock('@/const/dir', () => ({
  buildDir: '/mock/build',
  preloadDir: '/mock/preload',
  resourcesDir: '/mock/resources',
}));

vi.mock('@/const/env', () => ({
  isDev: false,
  isMac: false,
  isWindows: true,
}));

vi.mock('../../../const/theme', () => ({
  BACKGROUND_DARK: '#1a1a1a',
  BACKGROUND_LIGHT: '#ffffff',
  SYMBOL_COLOR_DARK: '#ffffff',
  SYMBOL_COLOR_LIGHT: '#000000',
  THEME_CHANGE_DELAY: 0,
}));

describe('Browser', () => {
  let browser: Browser;
  let mockApp: AppCore;
  let mockStoreManagerGet: ReturnType<typeof vi.fn>;
  let mockStoreManagerSet: ReturnType<typeof vi.fn>;
  let mockRemoteServerConfigCtr: {
    getAccessToken: ReturnType<typeof vi.fn>;
    getRemoteServerConfig: ReturnType<typeof vi.fn>;
  };
  let autoLoadUrlSpy: ReturnType<typeof vi.spyOn> | undefined;

  const defaultOptions: BrowserWindowOpts = {
    height: 600,
    identifier: 'test-window',
    path: '/test',
    title: 'Test Window',
    width: 800,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset mock behaviors
    mockBrowserWindow.getBounds.mockReturnValue({ height: 600, width: 800, x: 0, y: 0 });
    mockBrowserWindow.isDestroyed.mockReturnValue(false);
    mockBrowserWindow.isVisible.mockReturnValue(true);
    mockBrowserWindow.isFocused.mockReturnValue(true);
    mockBrowserWindow.isFullScreen.mockReturnValue(false);
    mockBrowserWindow.loadURL.mockResolvedValue(undefined);
    mockBrowserWindow.loadFile.mockResolvedValue(undefined);
    mockNativeTheme.shouldUseDarkColors = false;

    // Create mock App
    mockStoreManagerGet = vi.fn().mockReturnValue(undefined);
    mockStoreManagerSet = vi.fn();

    // Browser setup now installs protocol handlers that depend on RemoteServerConfigCtr
    mockRemoteServerConfigCtr = {
      getAccessToken: vi.fn().mockResolvedValue(null),
      getRemoteServerConfig: vi.fn().mockResolvedValue({
        remoteServerUrl: 'http://localhost:3000',
      }),
    };

    // Ensure Browser can register protocol handlers on the session
    (mockBrowserWindow.webContents.session as any).protocol = {
      handle: vi.fn(),
    };

    mockApp = {
      browserManager: {
        retrieveByIdentifier: vi.fn(),
      },
      buildRendererUrl: vi.fn(async (path: string) => {
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        return `http://localhost:3000${cleanPath}`;
      }),
      getController: vi.fn((ctr: any) => {
        // Only the remote server config controller is required in these unit tests
        if (ctr?.name === 'RemoteServerConfigCtr') return mockRemoteServerConfigCtr;
        throw new Error(`Unexpected controller requested in Browser tests: ${ctr?.name ?? ctr}`);
      }),
      isQuiting: false,
      nextServerUrl: 'http://localhost:3000',
      storeManager: {
        get: mockStoreManagerGet,
        set: mockStoreManagerSet,
      },
    } as unknown as AppCore;

    browser = new Browser(defaultOptions, mockApp);
    // The constructor triggers an async placeholder->loadUrl chain; stub it to avoid cross-test flakiness.
    autoLoadUrlSpy = vi.spyOn(browser, 'loadUrl').mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should set identifier and options', () => {
      expect(browser.identifier).toBe('test-window');
      expect(browser.options).toEqual(defaultOptions);
    });

    it('should create BrowserWindow on construction', () => {
      expect(MockBrowserWindow).toHaveBeenCalled();
    });
  });

  describe('browserWindow getter', () => {
    it('should return existing window if not destroyed', () => {
      mockBrowserWindow.isDestroyed.mockReturnValue(false);

      const win1 = browser.browserWindow;
      const win2 = browser.browserWindow;

      // Should not create a new window
      expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
      expect(win1).toBe(win2);
    });
  });

  describe('webContents getter', () => {
    it('should return webContents when window not destroyed', () => {
      mockBrowserWindow.isDestroyed.mockReturnValue(false);

      expect(browser.webContents).toBe(mockBrowserWindow.webContents);
    });

    it('should return null when window is destroyed', () => {
      mockBrowserWindow.isDestroyed.mockReturnValue(true);

      expect(browser.webContents).toBeNull();
    });
  });

  describe('retrieveOrInitialize', () => {
    it('should restore window size from store', () => {
      mockStoreManagerGet.mockImplementation((key: string) => {
        if (key === 'windowSize_test-window') {
          return { height: 700, width: 900 };
        }
        return undefined;
      });

      // Create new browser to trigger initialization with saved state
      const newBrowser = new Browser(defaultOptions, mockApp);

      expect(MockBrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          height: 700,
          width: 900,
        }),
      );
    });

    it('should restore window position from store and clamp within display', () => {
      mockStoreManagerGet.mockImplementation((key: string) => {
        if (key === 'windowSize_test-window') {
          return { height: 700, width: 900, x: 1800, y: 900 };
        }
        return undefined;
      });

      new Browser(defaultOptions, mockApp);

      expect(MockBrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          height: 700,
          width: 900,
          x: 1020,
          y: 380,
        }),
      );
    });

    it('should clamp saved size when it exceeds current display bounds', () => {
      mockScreen.getDisplayMatching.mockReturnValueOnce({
        workArea: { height: 800, width: 1200, x: 0, y: 0 },
      });
      mockStoreManagerGet.mockImplementation((key: string) => {
        if (key === 'windowSize_test-window') {
          return { height: 1200, width: 2000, x: 0, y: 0 };
        }
        return undefined;
      });

      new Browser(defaultOptions, mockApp);

      expect(MockBrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          height: 800,
          width: 1200,
        }),
      );
    });

    it('should use default size when no saved state', () => {
      mockStoreManagerGet.mockReturnValue(undefined);

      expect(MockBrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          height: 600,
          width: 800,
        }),
      );
    });

    it('should setup theme listener', () => {
      expect(mockNativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function));
    });

    it('should setup CORS bypass', () => {
      expect(mockBrowserWindow.webContents.session.webRequest.onHeadersReceived).toHaveBeenCalled();
    });

    it('should open devTools when devTools option is true', () => {
      const optionsWithDevTools: BrowserWindowOpts = {
        ...defaultOptions,
        devTools: true,
      };

      new Browser(optionsWithDevTools, mockApp);

      expect(mockBrowserWindow.webContents.openDevTools).toHaveBeenCalled();
    });
  });

  describe('theme management', () => {
    describe('getPlatformThemeConfig', () => {
      it('should return Windows dark theme config when shouldUseDarkColors is true', () => {
        mockNativeTheme.shouldUseDarkColors = true;

        // Create browser with dark mode
        const darkBrowser = new Browser(defaultOptions, mockApp);

        expect(MockBrowserWindow).toHaveBeenCalledWith(
          expect.objectContaining({
            backgroundColor: '#1a1a1a',
            titleBarOverlay: expect.objectContaining({
              color: '#00000000',
              symbolColor: '#ffffff',
            }),
          }),
        );
      });

      it('should return Windows light theme config when shouldUseDarkColors is false', () => {
        mockNativeTheme.shouldUseDarkColors = false;

        expect(MockBrowserWindow).toHaveBeenCalledWith(
          expect.objectContaining({
            backgroundColor: '#ffffff',
            titleBarOverlay: expect.objectContaining({
              color: '#00000000',
              symbolColor: '#000000',
            }),
          }),
        );
      });
    });

    describe('handleThemeChange', () => {
      it('should reapply visual effects on theme change', () => {
        // Get the theme change handler
        const themeHandler = mockNativeTheme.on.mock.calls.find(
          (call) => call[0] === 'updated',
        )?.[1];

        expect(themeHandler).toBeDefined();

        // Trigger theme change
        themeHandler();
        vi.advanceTimersByTime(0);

        // Should update window background and title bar
        expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalled();
        expect(mockBrowserWindow.setTitleBarOverlay).toHaveBeenCalled();
      });
    });

    describe('handleAppThemeChange', () => {
      it('should reapply visual effects', () => {
        browser.handleAppThemeChange();
        vi.advanceTimersByTime(0);

        expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalled();
        expect(mockBrowserWindow.setTitleBarOverlay).toHaveBeenCalled();
      });
    });

    describe('isDarkMode', () => {
      it('should return true when shouldUseDarkColors is true', () => {
        mockNativeTheme.shouldUseDarkColors = true;

        const darkBrowser = new Browser(defaultOptions, mockApp);
        // Access private getter through handleAppThemeChange which uses isDarkMode
        darkBrowser.handleAppThemeChange();
        vi.advanceTimersByTime(0);

        expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalledWith('#1a1a1a');
      });

      it('should return false when shouldUseDarkColors is false', () => {
        mockNativeTheme.shouldUseDarkColors = false;

        const lightBrowser = new Browser(defaultOptions, mockApp);
        lightBrowser.handleAppThemeChange();
        vi.advanceTimersByTime(0);

        expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalledWith('#ffffff');
      });
    });
  });

  describe('loadUrl', () => {
    it('should load full URL successfully', async () => {
      autoLoadUrlSpy?.mockRestore();
      await browser.loadUrl('/test-path');

      expect(mockBrowserWindow.loadURL).toHaveBeenCalledWith('http://localhost:3000/test-path');
    });

    it('should load error page on failure', async () => {
      autoLoadUrlSpy?.mockRestore();
      mockBrowserWindow.loadURL.mockRejectedValueOnce(new Error('Load failed'));

      await browser.loadUrl('/test-path');

      expect(mockBrowserWindow.loadFile).toHaveBeenCalledWith('/mock/resources/error.html');
    });

    it('should setup retry handler on error', async () => {
      autoLoadUrlSpy?.mockRestore();
      mockBrowserWindow.loadURL.mockRejectedValueOnce(new Error('Load failed'));

      await browser.loadUrl('/test-path');

      expect(mockIpcMain.removeHandler).toHaveBeenCalledWith('retry-connection');
      expect(mockIpcMain.handle).toHaveBeenCalledWith('retry-connection', expect.any(Function));
    });

    it('should load fallback HTML when error page fails', async () => {
      autoLoadUrlSpy?.mockRestore();
      mockBrowserWindow.loadURL.mockRejectedValueOnce(new Error('Load failed'));
      mockBrowserWindow.loadURL.mockResolvedValueOnce(undefined);
      mockBrowserWindow.loadFile.mockImplementation(async (filePath: string) => {
        if (filePath === '/mock/resources/error.html') throw new Error('Error page failed');
        return undefined;
      });

      await browser.loadUrl('/test-path');

      expect(mockBrowserWindow.loadURL).toHaveBeenCalledWith(
        expect.stringContaining('data:text/html'),
      );
    });
  });

  describe('loadPlaceholder', () => {
    it('should load splash screen', async () => {
      await browser.loadPlaceholder();

      expect(mockBrowserWindow.loadFile).toHaveBeenCalledWith('/mock/resources/splash.html');
    });
  });

  describe('window operations', () => {
    describe('show', () => {
      it('should show window', () => {
        browser.show();

        expect(mockBrowserWindow.show).toHaveBeenCalled();
      });
    });

    describe('hide', () => {
      it('should hide window', () => {
        mockBrowserWindow.isFullScreen.mockReturnValue(false);

        browser.hide();

        expect(mockBrowserWindow.hide).toHaveBeenCalled();
      });
    });

    describe('close', () => {
      it('should close window', () => {
        browser.close();

        expect(mockBrowserWindow.close).toHaveBeenCalled();
      });
    });

    describe('moveToCenter', () => {
      it('should center window', () => {
        browser.moveToCenter();

        expect(mockBrowserWindow.center).toHaveBeenCalled();
      });
    });

    describe('setWindowSize', () => {
      it('should set window bounds', () => {
        browser.setWindowSize({ height: 700, width: 900 });

        expect(mockBrowserWindow.setBounds).toHaveBeenCalledWith({
          height: 700,
          width: 900,
        });
      });

      it('should use current size for missing dimensions', () => {
        mockBrowserWindow.getBounds.mockReturnValue({ height: 600, width: 800 });

        browser.setWindowSize({ width: 900 });

        expect(mockBrowserWindow.setBounds).toHaveBeenCalledWith({
          height: 600,
          width: 900,
        });
      });
    });

    describe('toggleVisible', () => {
      it('should hide when visible and focused', () => {
        mockBrowserWindow.isVisible.mockReturnValue(true);
        mockBrowserWindow.isFocused.mockReturnValue(true);

        browser.toggleVisible();

        expect(mockBrowserWindow.hide).toHaveBeenCalled();
      });

      it('should show and focus when not visible', () => {
        mockBrowserWindow.isVisible.mockReturnValue(false);

        browser.toggleVisible();

        expect(mockBrowserWindow.show).toHaveBeenCalled();
        expect(mockBrowserWindow.focus).toHaveBeenCalled();
      });

      it('should show and focus when visible but not focused', () => {
        mockBrowserWindow.isVisible.mockReturnValue(true);
        mockBrowserWindow.isFocused.mockReturnValue(false);

        browser.toggleVisible();

        expect(mockBrowserWindow.show).toHaveBeenCalled();
        expect(mockBrowserWindow.focus).toHaveBeenCalled();
      });
    });
  });

  describe('broadcast', () => {
    it('should send message to webContents', () => {
      browser.broadcast('updateAvailable' as any, { version: '1.0.0' } as any);

      expect(mockBrowserWindow.webContents.send).toHaveBeenCalledWith('updateAvailable', {
        version: '1.0.0',
      });
    });

    it('should not send when window is destroyed', () => {
      mockBrowserWindow.isDestroyed.mockReturnValue(true);

      browser.broadcast('updateAvailable' as any);

      expect(mockBrowserWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should cleanup theme listener', () => {
      browser.destroy();

      expect(mockNativeTheme.off).toHaveBeenCalledWith('updated', expect.any(Function));
    });
  });

  describe('close event handling', () => {
    let closeHandler: (e: any) => void;

    beforeEach(() => {
      // Get the close handler registered during initialization
      closeHandler = mockBrowserWindow.on.mock.calls.find((call) => call[0] === 'close')?.[1];
    });

    it('should save window size and allow close when app is quitting', () => {
      (mockApp as any).isQuiting = true;
      const mockEvent = { preventDefault: vi.fn() };

      closeHandler(mockEvent);

      expect(mockStoreManagerSet).toHaveBeenCalledWith('windowSize_test-window', {
        height: 600,
        width: 800,
        x: 0,
        y: 0,
      });
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });

    it('should hide instead of close when keepAlive is true', () => {
      const keepAliveOptions: BrowserWindowOpts = {
        ...defaultOptions,
        keepAlive: true,
      };
      const keepAliveBrowser = new Browser(keepAliveOptions, mockApp);

      // Get the new close handler
      const keepAliveCloseHandler = mockBrowserWindow.on.mock.calls
        .filter((call) => call[0] === 'close')
        .pop()?.[1];

      const mockEvent = { preventDefault: vi.fn() };
      keepAliveCloseHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockBrowserWindow.hide).toHaveBeenCalled();
    });

    it('should save size and allow close when keepAlive is false', () => {
      const mockEvent = { preventDefault: vi.fn() };

      closeHandler(mockEvent);

      expect(mockStoreManagerSet).toHaveBeenCalledWith('windowSize_test-window', {
        height: 600,
        width: 800,
        x: 0,
        y: 0,
      });
    });
  });

  describe('reapplyVisualEffects', () => {
    it('should apply visual effects', () => {
      browser.reapplyVisualEffects();

      expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalled();
      expect(mockBrowserWindow.setTitleBarOverlay).toHaveBeenCalled();
    });

    it('should not apply when window is destroyed', () => {
      mockBrowserWindow.isDestroyed.mockReturnValue(true);
      mockBrowserWindow.setBackgroundColor.mockClear();

      browser.reapplyVisualEffects();

      expect(mockBrowserWindow.setBackgroundColor).not.toHaveBeenCalled();
    });
  });

  describe('will-prevent-unload event handling', () => {
    let willPreventUnloadHandler: (e: any) => void;

    beforeEach(() => {
      // Get the will-prevent-unload handler registered during initialization
      willPreventUnloadHandler = mockBrowserWindow.webContents.on.mock.calls.find(
        (call) => call[0] === 'will-prevent-unload',
      )?.[1];
    });

    it('should call preventDefault when app is quitting', () => {
      (mockApp as any).isQuiting = true;
      const mockEvent = { preventDefault: vi.fn() };

      expect(willPreventUnloadHandler).toBeDefined();
      willPreventUnloadHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should not call preventDefault when app is not quitting', () => {
      (mockApp as any).isQuiting = false;
      const mockEvent = { preventDefault: vi.fn() };

      expect(willPreventUnloadHandler).toBeDefined();
      willPreventUnloadHandler(mockEvent);

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });
});
