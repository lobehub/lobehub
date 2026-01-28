import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WindowThemeManager } from '../WindowThemeManager';

// Use vi.hoisted to define mocks before hoisting
const { mockNativeTheme, mockBrowserWindow } = vi.hoisted(() => ({
  mockBrowserWindow: {
    isDestroyed: vi.fn().mockReturnValue(false),
    setBackgroundColor: vi.fn(),
    setTitleBarOverlay: vi.fn(),
  },
  mockNativeTheme: {
    off: vi.fn(),
    on: vi.fn(),
    shouldUseDarkColors: false,
  },
}));

vi.mock('electron', () => ({
  nativeTheme: mockNativeTheme,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@/const/dir', () => ({
  buildDir: '/mock/build',
}));

vi.mock('@/const/env', () => ({
  isDev: false,
  isWindows: true,
}));

vi.mock('@lobechat/desktop-bridge', () => ({
  TITLE_BAR_HEIGHT: 38,
}));

vi.mock('../../../const/theme', () => ({
  BACKGROUND_DARK: '#1a1a1a',
  BACKGROUND_LIGHT: '#ffffff',
  SYMBOL_COLOR_DARK: '#ffffff',
  SYMBOL_COLOR_LIGHT: '#000000',
  THEME_CHANGE_DELAY: 0,
}));

describe('WindowThemeManager', () => {
  let manager: WindowThemeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockNativeTheme.shouldUseDarkColors = false;
    mockBrowserWindow.isDestroyed.mockReturnValue(false);

    manager = new WindowThemeManager('test-window');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isDarkMode', () => {
    it('should return true when shouldUseDarkColors is true', () => {
      mockNativeTheme.shouldUseDarkColors = true;

      expect(manager.isDarkMode).toBe(true);
    });

    it('should return false when shouldUseDarkColors is false', () => {
      mockNativeTheme.shouldUseDarkColors = false;

      expect(manager.isDarkMode).toBe(false);
    });
  });

  describe('getPlatformConfig', () => {
    it('should return Windows dark theme config when in dark mode', () => {
      mockNativeTheme.shouldUseDarkColors = true;

      const config = manager.getPlatformConfig();

      expect(config).toEqual({
        backgroundColor: '#1a1a1a',
        icon: undefined,
        titleBarOverlay: {
          color: '#00000000',
          height: 36,
          symbolColor: '#ffffff',
        },
        titleBarStyle: 'hidden',
      });
    });

    it('should return Windows light theme config when in light mode', () => {
      mockNativeTheme.shouldUseDarkColors = false;

      const config = manager.getPlatformConfig();

      expect(config).toEqual({
        backgroundColor: '#ffffff',
        icon: undefined,
        titleBarOverlay: {
          color: '#00000000',
          height: 36,
          symbolColor: '#000000',
        },
        titleBarStyle: 'hidden',
      });
    });
  });

  describe('attach', () => {
    it('should setup theme listener', () => {
      manager.attach(mockBrowserWindow as any);

      expect(mockNativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function));
    });

    it('should apply initial visual effects', () => {
      manager.attach(mockBrowserWindow as any);

      expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalled();
      expect(mockBrowserWindow.setTitleBarOverlay).toHaveBeenCalled();
    });

    it('should not setup duplicate listeners', () => {
      manager.attach(mockBrowserWindow as any);
      manager.attach(mockBrowserWindow as any);

      expect(mockNativeTheme.on).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanup', () => {
    it('should remove theme listener', () => {
      manager.attach(mockBrowserWindow as any);
      manager.cleanup();

      expect(mockNativeTheme.off).toHaveBeenCalledWith('updated', expect.any(Function));
    });

    it('should not throw if cleanup called without attach', () => {
      expect(() => manager.cleanup()).not.toThrow();
      expect(mockNativeTheme.off).not.toHaveBeenCalled();
    });
  });

  describe('handleAppThemeChange', () => {
    it('should reapply visual effects after delay', () => {
      manager.attach(mockBrowserWindow as any);
      mockBrowserWindow.setBackgroundColor.mockClear();
      mockBrowserWindow.setTitleBarOverlay.mockClear();

      manager.handleAppThemeChange();
      vi.advanceTimersByTime(0);

      expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalled();
      expect(mockBrowserWindow.setTitleBarOverlay).toHaveBeenCalled();
    });
  });

  describe('reapplyVisualEffects', () => {
    it('should apply visual effects', () => {
      manager.attach(mockBrowserWindow as any);
      mockBrowserWindow.setBackgroundColor.mockClear();

      manager.reapplyVisualEffects();

      expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalled();
    });
  });

  describe('applyVisualEffects', () => {
    it('should apply dark theme when in dark mode', () => {
      mockNativeTheme.shouldUseDarkColors = true;
      manager.attach(mockBrowserWindow as any);

      expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalledWith('#1a1a1a');
      expect(mockBrowserWindow.setTitleBarOverlay).toHaveBeenCalledWith({
        color: '#00000000',
        height: 36,
        symbolColor: '#ffffff',
      });
    });

    it('should apply light theme when in light mode', () => {
      mockNativeTheme.shouldUseDarkColors = false;
      manager.attach(mockBrowserWindow as any);

      expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalledWith('#ffffff');
      expect(mockBrowserWindow.setTitleBarOverlay).toHaveBeenCalledWith({
        color: '#00000000',
        height: 36,
        symbolColor: '#000000',
      });
    });

    it('should not apply effects when window is destroyed', () => {
      manager.attach(mockBrowserWindow as any);
      mockBrowserWindow.setBackgroundColor.mockClear();
      mockBrowserWindow.isDestroyed.mockReturnValue(true);

      manager.reapplyVisualEffects();

      expect(mockBrowserWindow.setBackgroundColor).not.toHaveBeenCalled();
    });

    it('should not apply effects when no window attached', () => {
      // Manager without attached window
      const freshManager = new WindowThemeManager('fresh-window');

      // Should not throw
      expect(() => freshManager.reapplyVisualEffects()).not.toThrow();
    });
  });

  describe('theme change listener', () => {
    it('should reapply visual effects on system theme change', () => {
      manager.attach(mockBrowserWindow as any);

      // Get the theme change handler
      const themeHandler = mockNativeTheme.on.mock.calls.find((call) => call[0] === 'updated')?.[1];

      expect(themeHandler).toBeDefined();

      mockBrowserWindow.setBackgroundColor.mockClear();

      // Simulate theme change
      themeHandler();
      vi.advanceTimersByTime(0);

      expect(mockBrowserWindow.setBackgroundColor).toHaveBeenCalled();
    });
  });
});
