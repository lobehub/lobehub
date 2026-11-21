import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WindowThemeManager } from './WindowThemeManager';

const { glass, material, theme, window } = vi.hoisted(() => ({
  glass: { isSupported: vi.fn(), setWindowGlass: vi.fn() },
  material: { background: '' },
  theme: {
    off: vi.fn(),
    on: vi.fn(),
    shouldUseDarkColors: false,
    themeSource: 'system' as string,
  },
  window: {
    getNativeWindowHandle: vi.fn(() => Buffer.alloc(8)),
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
    setVibrancy: vi.fn(),
  },
}));

vi.mock('@lobechat/electron-mac-sidebar-glass', () => glass);
vi.mock('electron', () => ({ nativeTheme: theme }));
vi.mock('@/const/dir', () => ({ buildDir: '/mock/build' }));
vi.mock('@/const/env', () => ({ isDev: false, isLinux: false, isMac: true, isWindows: false }));

describe('macOS window glass lifecycle', () => {
  let manager: WindowThemeManager;
  const browserWindow = window as unknown as BrowserWindow;

  const setSystemVersion = (version: string) => {
    Object.defineProperty(process, 'getSystemVersion', {
      configurable: true,
      value: vi.fn(() => version),
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setSystemVersion('27.2.0');
    glass.isSupported.mockReturnValue(true);
    glass.setWindowGlass.mockImplementation((_handle, enabled) => {
      material.background = enabled ? 'sidebar' : '';
      return true;
    });
    window.setBackgroundColor.mockImplementation((color) => {
      material.background = color;
    });
    window.isDestroyed.mockReturnValue(false);
    window.isFullScreen.mockReturnValue(false);
    theme.shouldUseDarkColors = false;
    theme.themeSource = 'system';
    manager = new WindowThemeManager('glass-test');
  });

  afterEach(() => {
    manager.cleanup();
    vi.useRealTimers();
  });

  it('installs the material when the native window attaches, without a renderer', () => {
    manager.attach(browserWindow);

    expect(glass.setWindowGlass).toHaveBeenCalledWith(window.getNativeWindowHandle(), true, false);
    expect(window.setVibrancy).toHaveBeenLastCalledWith(null);
    expect(material.background).toBe('sidebar');
  });

  it('updates the material to the explicit app appearance', () => {
    manager.attach(browserWindow);
    theme.themeSource = 'dark';
    manager.handleAppThemeChange();
    vi.runAllTimers();

    expect(glass.setWindowGlass).toHaveBeenLastCalledWith(
      window.getNativeWindowHandle(),
      true,
      true,
    );
  });

  it('removes glass in fullscreen and reinstalls it when leaving', () => {
    manager.attach(browserWindow);
    manager.handleFullscreenChange(true);

    expect(glass.setWindowGlass).toHaveBeenLastCalledWith(
      window.getNativeWindowHandle(),
      false,
      false,
    );
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith('#f8f8f8');

    manager.handleFullscreenChange(false);

    expect(glass.setWindowGlass).toHaveBeenLastCalledWith(
      window.getNativeWindowHandle(),
      true,
      false,
    );
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith('#00000000');
    expect(window.setVibrancy).toHaveBeenLastCalledWith(null);
    expect(material.background).toBe('sidebar');
  });

  it('keeps Electron sidebar vibrancy on macOS 26', () => {
    setSystemVersion('26.6.0');
    manager.attach(browserWindow);

    expect(glass.setWindowGlass).not.toHaveBeenCalled();
    expect(window.setVibrancy).toHaveBeenLastCalledWith('sidebar');
  });

  it('keeps Electron sidebar vibrancy when native glass is unavailable', () => {
    glass.isSupported.mockReturnValue(false);
    manager.attach(browserWindow);

    expect(glass.setWindowGlass).not.toHaveBeenCalled();
    expect(window.setVibrancy).toHaveBeenLastCalledWith('sidebar');
  });

  it('restores Electron sidebar vibrancy when native installation fails', () => {
    glass.setWindowGlass.mockReturnValue(false);
    manager.attach(browserWindow);

    expect(window.setVibrancy).toHaveBeenLastCalledWith('sidebar');
  });

  it('releases the native material and ignores queued updates after cleanup', () => {
    manager.attach(browserWindow);
    manager.handleAppThemeChange();
    manager.cleanup();
    expect(glass.setWindowGlass).toHaveBeenLastCalledWith(
      window.getNativeWindowHandle(),
      false,
      false,
    );
    glass.setWindowGlass.mockClear();
    vi.runAllTimers();

    expect(glass.setWindowGlass).not.toHaveBeenCalled();
    expect(theme.off).toHaveBeenCalled();
  });
});
