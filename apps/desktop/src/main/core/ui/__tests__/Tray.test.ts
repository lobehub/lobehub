import { app, Menu, nativeImage, Tray as ElectronTray } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '../../App';
import { Tray } from '../Tray';

// Mock electron modules
vi.mock('electron', () => ({
  Tray: vi.fn(),
  Menu: {
    buildFromTemplate: vi.fn(),
  },
  nativeImage: {
    createFromPath: vi.fn(),
  },
  app: {
    quit: vi.fn(),
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

// Mock dir constants
vi.mock('@/const/dir', () => ({
  resourcesDir: '/mock/resources',
}));

describe('Tray', () => {
  let tray: Tray;
  let mockApp: App;
  let mockElectronTray: any;
  let mockBrowserWindow: any;
  let mockMainWindow: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Electron Tray instance
    mockElectronTray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      popUpContextMenu: vi.fn(),
      setImage: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn(),
      displayBalloon: vi.fn(),
    };

    // Mock BrowserWindow
    mockBrowserWindow = {
      isVisible: vi.fn(),
      isFocused: vi.fn(),
      focus: vi.fn(),
    };

    // Mock MainWindow
    mockMainWindow = {
      browserWindow: mockBrowserWindow,
      hide: vi.fn(),
      show: vi.fn(),
      broadcast: vi.fn(),
    };

    // Mock App
    mockApp = {
      browserManager: {
        showMainWindow: vi.fn(),
        getMainWindow: vi.fn(() => mockMainWindow),
      },
      screenCaptureManager: {
        startSession: vi.fn(),
      },
    } as unknown as App;

    // Mock electron constructors
    vi.mocked(ElectronTray).mockImplementation(() => mockElectronTray);
    vi.mocked(nativeImage.createFromPath).mockReturnValue({
      setTemplateImage: vi.fn(),
    } as any);
    vi.mocked(Menu.buildFromTemplate).mockReturnValue({} as any);
  });

  describe('constructor', () => {
    it('should initialize tray with provided options', () => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
          tooltip: 'Test Tray',
        },
        mockApp,
      );

      expect(tray.identifier).toBe('test-tray');
      expect(tray.options.iconPath).toBe('tray.png');
      expect(tray.options.tooltip).toBe('Test Tray');
    });

    it('should call retrieveOrInitialize during construction', () => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );

      expect(nativeImage.createFromPath).toHaveBeenCalledWith('/mock/resources/tray.png');
      expect(ElectronTray).toHaveBeenCalled();
    });
  });

  describe('retrieveOrInitialize', () => {
    it('should create new tray instance with icon and tooltip', () => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
          tooltip: 'Test Tray',
        },
        mockApp,
      );

      expect(nativeImage.createFromPath).toHaveBeenCalledWith('/mock/resources/tray.png');
      expect(ElectronTray).toHaveBeenCalled();
      expect(mockElectronTray.setToolTip).toHaveBeenCalledWith('Test Tray');
    });

    it('should not set tooltip if not provided', () => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );

      expect(mockElectronTray.setToolTip).not.toHaveBeenCalled();
    });

    it('should return existing tray instance if already created', () => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );

      const firstTray = tray.tray;
      const secondTray = tray.tray;

      expect(firstTray).toBe(secondTray);
      expect(ElectronTray).toHaveBeenCalledTimes(1);
    });

    it('should register click event handler', () => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );

      expect(mockElectronTray.on).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('should build the default context menu and store it in-house', () => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      // We no longer hand the menu to Electron directly; macOS would hijack
      // left-click if we did. The menu is popped up manually on right-click.
      expect(mockElectronTray.setContextMenu).not.toHaveBeenCalled();
    });

    it('should register both click and right-click listeners', () => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );

      const events = mockElectronTray.on.mock.calls.map((c: any[]) => c[0]);
      expect(events).toContain('click');
      expect(events).toContain('right-click');
    });

    it('should handle errors when creating tray', () => {
      const error = new Error('Failed to create tray');
      vi.mocked(ElectronTray).mockImplementation(() => {
        throw error;
      });

      expect(() => {
        tray = new Tray(
          {
            iconPath: 'tray.png',
            identifier: 'test-tray',
          },
          mockApp,
        );
      }).toThrow(error);
    });
  });

  describe('setContextMenu', () => {
    beforeEach(() => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );
      vi.clearAllMocks();
    });

    it('should set default context menu when no template provided', () => {
      tray.setContextMenu();

      expect(Menu.buildFromTemplate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Show Main Window' }),
          expect.objectContaining({ type: 'separator' }),
          expect.objectContaining({ label: 'Quit' }),
        ]),
      );
      // Menu is stored for manual popup on right-click — never handed to
      // `_tray.setContextMenu`, which would steal left-click on macOS.
      expect(mockElectronTray.setContextMenu).not.toHaveBeenCalled();
    });

    it('should set custom context menu when template provided', () => {
      const customTemplate = [
        { label: 'Custom Item 1', click: vi.fn() },
        { label: 'Custom Item 2', click: vi.fn() },
      ];

      tray.setContextMenu(customTemplate);

      expect(Menu.buildFromTemplate).toHaveBeenCalledWith(customTemplate);
      expect(mockElectronTray.setContextMenu).not.toHaveBeenCalled();
    });

    it('should pop up the stored menu on right-click', () => {
      // beforeEach cleared mocks after constructing the tray, so capture the
      // right-click handler from a fresh instance.
      const mockTrayForRightClick = {
        setToolTip: vi.fn(),
        setContextMenu: vi.fn(),
        popUpContextMenu: vi.fn(),
        setImage: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
        displayBalloon: vi.fn(),
      };
      vi.mocked(ElectronTray).mockImplementationOnce(() => mockTrayForRightClick as any);

      const builtMenu = { _mockMenu: true } as any;
      vi.mocked(Menu.buildFromTemplate).mockReturnValue(builtMenu);

      const freshTray = new Tray({ iconPath: 'tray.png', identifier: 'rc-tray' }, mockApp);
      freshTray.setContextMenu();

      const rightClickHandler = mockTrayForRightClick.on.mock.calls.find(
        (c: any[]) => c[0] === 'right-click',
      )?.[1];
      expect(rightClickHandler).toBeDefined();

      rightClickHandler?.();

      expect(mockTrayForRightClick.popUpContextMenu).toHaveBeenCalledWith(builtMenu);
    });

    it('should call showMainWindow when Show Main Window is clicked', () => {
      tray.setContextMenu();

      const templateArg = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0];
      const showMainWindowItem = templateArg.find((item: any) => item.label === 'Show Main Window');

      showMainWindowItem?.click?.(null as any, null as any, null as any);

      expect(mockApp.browserManager.showMainWindow).toHaveBeenCalled();
    });

    it('should call app.quit when Quit is clicked', () => {
      tray.setContextMenu();

      const templateArg = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0];
      const quitItem = templateArg.find((item: any) => item.label === 'Quit');

      quitItem?.click?.(null as any, null as any, null as any);

      expect(app.quit).toHaveBeenCalled();
    });
  });

  describe('onClick', () => {
    beforeEach(() => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );
    });

    it('should start the Quick Composer capture session', () => {
      tray.onClick();

      expect(mockApp.screenCaptureManager.startSession).toHaveBeenCalled();
    });

    it('should not touch main window visibility', () => {
      tray.onClick();

      expect(mockMainWindow.hide).not.toHaveBeenCalled();
      expect(mockMainWindow.show).not.toHaveBeenCalled();
    });

    it('should not throw when startSession rejects', () => {
      vi.mocked(mockApp.screenCaptureManager.startSession).mockImplementationOnce(() => {
        throw new Error('capture failed');
      });

      expect(() => tray.onClick()).not.toThrow();
    });
  });

  describe('updateIcon', () => {
    beforeEach(() => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );
      vi.clearAllMocks();
    });

    it('should update tray icon successfully', () => {
      const newIcon = {};
      vi.mocked(nativeImage.createFromPath).mockReturnValue(newIcon as any);

      tray.updateIcon('new-icon.png');

      expect(nativeImage.createFromPath).toHaveBeenCalledWith('/mock/resources/new-icon.png');
      expect(mockElectronTray.setImage).toHaveBeenCalledWith(newIcon);
      expect(tray.options.iconPath).toBe('new-icon.png');
    });

    it('should handle errors when updating icon', () => {
      const error = new Error('Failed to load icon');
      vi.mocked(nativeImage.createFromPath).mockImplementation(() => {
        throw error;
      });

      expect(() => tray.updateIcon('bad-icon.png')).not.toThrow();
    });
  });

  describe('updateTooltip', () => {
    beforeEach(() => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );
    });

    it('should update tray tooltip successfully', () => {
      tray.updateTooltip('New Tooltip');

      expect(mockElectronTray.setToolTip).toHaveBeenCalledWith('New Tooltip');
      expect(tray.options.tooltip).toBe('New Tooltip');
    });
  });

  describe('displayBalloon', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    beforeEach(() => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );
    });

    it('should display balloon notification on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const options = {
        title: 'Test',
        content: 'Test content',
      };

      tray.displayBalloon(options);

      expect(mockElectronTray.displayBalloon).toHaveBeenCalledWith(options);
    });

    it('should not display balloon notification on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const options = {
        title: 'Test',
        content: 'Test content',
      };

      tray.displayBalloon(options);

      expect(mockElectronTray.displayBalloon).not.toHaveBeenCalled();
    });

    it('should not display balloon notification on Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const options = {
        title: 'Test',
        content: 'Test content',
      };

      tray.displayBalloon(options);

      expect(mockElectronTray.displayBalloon).not.toHaveBeenCalled();
    });
  });

  describe('broadcast', () => {
    beforeEach(() => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );
    });

    it('should broadcast message to main window', () => {
      const channel = 'test-channel' as any;
      const data = { test: 'data' };

      tray.broadcast(channel, data);

      expect(mockApp.browserManager.getMainWindow).toHaveBeenCalled();
      expect(mockMainWindow.broadcast).toHaveBeenCalledWith(channel, data);
    });

    it('should handle case when main window is null', () => {
      vi.mocked(mockApp.browserManager.getMainWindow).mockReturnValue(null);

      expect(() => tray.broadcast('test-channel' as any)).not.toThrow();
    });
  });

  describe('destroy', () => {
    beforeEach(() => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
        },
        mockApp,
      );
    });

    it('should destroy tray instance', () => {
      tray.destroy();

      expect(mockElectronTray.destroy).toHaveBeenCalled();
    });

    it('should handle multiple destroy calls', () => {
      tray.destroy();
      tray.destroy();

      expect(mockElectronTray.destroy).toHaveBeenCalledTimes(1);
    });

    it('should allow creating new tray after destroy', () => {
      tray.destroy();
      vi.clearAllMocks();

      const newTray = tray.tray;

      expect(newTray).toBeDefined();
      expect(ElectronTray).toHaveBeenCalled();
    });
  });

  describe('integration tests', () => {
    it('should handle complete tray lifecycle', () => {
      tray = new Tray(
        {
          iconPath: 'tray.png',
          identifier: 'test-tray',
          tooltip: 'Test Tray',
        },
        mockApp,
      );

      // Verify creation
      expect(tray.tray).toBeDefined();
      expect(mockElectronTray.setToolTip).toHaveBeenCalledWith('Test Tray');

      // Update icon
      tray.updateIcon('new-icon.png');
      expect(mockElectronTray.setImage).toHaveBeenCalled();

      // Update tooltip
      tray.updateTooltip('New Tooltip');
      expect(mockElectronTray.setToolTip).toHaveBeenCalledWith('New Tooltip');

      // Test click behavior — now opens the Quick Composer session
      tray.onClick();
      expect(mockApp.screenCaptureManager.startSession).toHaveBeenCalled();

      // Destroy
      tray.destroy();
      expect(mockElectronTray.destroy).toHaveBeenCalled();
    });
  });
});
