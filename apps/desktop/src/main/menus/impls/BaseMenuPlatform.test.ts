import { BrowserWindow, type BrowserWindow as ElectronBrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import { BaseMenuPlatform } from './BaseMenuPlatform';

// Create a concrete implementation for testing
class TestMenuPlatform extends BaseMenuPlatform {}
class TestDevToolsMenuPlatform extends BaseMenuPlatform {
  buildDevToolsItem(label = 'Developer Tools', accelerator = 'F12') {
    return this.buildDevToolsMenuItem(label, accelerator);
  }
}

const createBrowserWindow = ({
  isDestroyed = false,
  isFocused = false,
  isMinimized = false,
  isDevToolsFocused = false,
  isDevToolsOpened = false,
}: {
  isDestroyed?: boolean;
  isFocused?: boolean;
  isMinimized?: boolean;
  isDevToolsFocused?: boolean;
  isDevToolsOpened?: boolean;
}) =>
  ({
    close: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => isDestroyed),
    isFocused: vi.fn(() => isFocused),
    isMinimized: vi.fn(() => isMinimized),
    on: vi.fn(),
    restore: vi.fn(),
    show: vi.fn(),
    webContents: {
      closeDevTools: vi.fn(),
      isDevToolsFocused: vi.fn(() => isDevToolsFocused),
      isDevToolsOpened: vi.fn(() => isDevToolsOpened),
      openDevTools: vi.fn(),
      setDevToolsWebContents: vi.fn(),
    },
  }) as unknown as ElectronBrowserWindow;

// Mock App instance
const mockApp = {
  i18n: {
    ns: vi.fn(),
  },
  browserManager: {
    getMainWindow: vi.fn(),
    showMainWindow: vi.fn(),
    retrieveByIdentifier: vi.fn(),
  },
  updaterManager: {
    checkForUpdates: vi.fn(),
  },
  menuManager: {
    rebuildAppMenu: vi.fn(),
  },
  storeManager: {
    openInEditor: vi.fn(),
  },
} as unknown as App;

describe('BaseMenuPlatform', () => {
  let menuPlatform: TestMenuPlatform;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(BrowserWindow).mockImplementation(() => createBrowserWindow({}));
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null);
    menuPlatform = new TestMenuPlatform(mockApp);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with app instance', () => {
      expect(menuPlatform['app']).toBe(mockApp);
    });

    it('should store app reference for subclasses', () => {
      const anotherInstance = new TestMenuPlatform(mockApp);
      expect(anotherInstance['app']).toBe(mockApp);
    });
  });

  describe('buildDevToolsMenuItem', () => {
    let devToolsMenuPlatform: TestDevToolsMenuPlatform;

    beforeEach(() => {
      devToolsMenuPlatform = new TestDevToolsMenuPlatform(mockApp);
    });

    it('should create a managed DevTools window when the target window has no DevTools open', () => {
      const devToolsWindow = createBrowserWindow({});
      vi.mocked(BrowserWindow).mockImplementation(() => devToolsWindow);
      const targetWindow = createBrowserWindow({ isDevToolsOpened: false });
      const item = devToolsMenuPlatform.buildDevToolsItem();

      item.click?.(undefined as any, targetWindow, undefined as any);

      expect(BrowserWindow).toHaveBeenCalledWith({
        autoHideMenuBar: true,
        height: 800,
        show: false,
        title: 'Developer Tools',
        width: 1200,
      });
      expect(targetWindow.webContents.setDevToolsWebContents).toHaveBeenCalledWith(
        devToolsWindow.webContents,
      );
      expect(targetWindow.webContents.openDevTools).toHaveBeenCalledWith({
        activate: true,
        mode: 'detach',
      });
      expect(devToolsWindow.show).toHaveBeenCalled();
      expect(devToolsWindow.focus).toHaveBeenCalled();
      expect(targetWindow.webContents.closeDevTools).not.toHaveBeenCalled();
    });

    it('should close managed DevTools when they are already focused', () => {
      const devToolsWindow = createBrowserWindow({ isFocused: true });
      const targetWindow = createBrowserWindow({
        isDevToolsOpened: true,
      });
      const item = devToolsMenuPlatform.buildDevToolsItem();
      (devToolsMenuPlatform as any).devToolsWindows.set(targetWindow, devToolsWindow);

      item.click?.(undefined as any, targetWindow, undefined as any);

      expect(targetWindow.webContents.closeDevTools).toHaveBeenCalled();
      expect(devToolsWindow.close).toHaveBeenCalled();
      expect(targetWindow.webContents.openDevTools).not.toHaveBeenCalled();
    });

    it('should focus managed DevTools when they are open but not focused', () => {
      const devToolsWindow = createBrowserWindow({
        isFocused: false,
        isMinimized: true,
      });
      const targetWindow = createBrowserWindow({
        isDevToolsOpened: true,
      });
      const item = devToolsMenuPlatform.buildDevToolsItem();
      (devToolsMenuPlatform as any).devToolsWindows.set(targetWindow, devToolsWindow);

      item.click?.(undefined as any, targetWindow, undefined as any);

      expect(devToolsWindow.restore).toHaveBeenCalled();
      expect(devToolsWindow.show).toHaveBeenCalled();
      expect(devToolsWindow.focus).toHaveBeenCalled();
      expect(targetWindow.webContents.closeDevTools).not.toHaveBeenCalled();
      expect(targetWindow.webContents.openDevTools).not.toHaveBeenCalled();
    });

    it('should replace default DevTools with a managed DevTools window', () => {
      vi.useFakeTimers();
      const devToolsWindow = createBrowserWindow({});
      vi.mocked(BrowserWindow).mockImplementation(() => devToolsWindow);
      const targetWindow = createBrowserWindow({
        isDevToolsFocused: false,
        isDevToolsOpened: true,
      });
      const item = devToolsMenuPlatform.buildDevToolsItem();

      item.click?.(undefined as any, targetWindow, undefined as any);

      expect(targetWindow.webContents.closeDevTools).toHaveBeenCalled();
      expect(targetWindow.webContents.openDevTools).not.toHaveBeenCalled();
      vi.runOnlyPendingTimers();

      expect(targetWindow.webContents.setDevToolsWebContents).toHaveBeenCalledWith(
        devToolsWindow.webContents,
      );
      expect(targetWindow.webContents.openDevTools).toHaveBeenCalledWith({
        activate: true,
        mode: 'detach',
      });
      expect(devToolsWindow.show).toHaveBeenCalled();
      expect(devToolsWindow.focus).toHaveBeenCalled();
    });

    it('should not create managed DevTools after the target window is destroyed', () => {
      vi.useFakeTimers();
      const targetWindow = createBrowserWindow({
        isDestroyed: true,
        isDevToolsFocused: false,
        isDevToolsOpened: true,
      });
      const item = devToolsMenuPlatform.buildDevToolsItem();

      item.click?.(undefined as any, targetWindow, undefined as any);
      vi.runOnlyPendingTimers();

      expect(targetWindow.webContents.closeDevTools).toHaveBeenCalled();
      expect(targetWindow.webContents.openDevTools).not.toHaveBeenCalled();
      expect(BrowserWindow).not.toHaveBeenCalled();
    });

    it('should close managed DevTools when the DevTools window is the menu target', () => {
      const targetWindow = createBrowserWindow({
        isDevToolsOpened: true,
      });
      const devToolsWindow = createBrowserWindow({ isFocused: true });
      const item = devToolsMenuPlatform.buildDevToolsItem();
      (devToolsMenuPlatform as any).devToolsWindows.set(targetWindow, devToolsWindow);

      item.click?.(undefined as any, devToolsWindow, undefined as any);

      expect(targetWindow.webContents.closeDevTools).toHaveBeenCalled();
      expect(devToolsWindow.close).toHaveBeenCalled();
      expect(targetWindow.webContents.openDevTools).not.toHaveBeenCalled();
    });

    it('should close focused default DevTools before creating managed DevTools', () => {
      const ownerWindow = createBrowserWindow({
        isDevToolsFocused: true,
        isDevToolsOpened: true,
      });
      const focusedDefaultDevToolsWindow = createBrowserWindow({});
      const item = devToolsMenuPlatform.buildDevToolsItem();
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([ownerWindow]);

      item.click?.(undefined as any, focusedDefaultDevToolsWindow, undefined as any);

      expect(ownerWindow.webContents.closeDevTools).toHaveBeenCalled();
      expect(BrowserWindow).not.toHaveBeenCalled();
      expect(focusedDefaultDevToolsWindow.webContents.openDevTools).not.toHaveBeenCalled();
    });
  });
});
