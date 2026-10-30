import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WindowThemeManager } from '../WindowThemeManager';

const { mockNativeTheme, mockBrowserWindow } = vi.hoisted(() => ({
  mockBrowserWindow: {
    isDestroyed: vi.fn(),
    isFullScreen: vi.fn(),
    setBackgroundColor: vi.fn(),
    setVibrancy: vi.fn(),
  },
  mockNativeTheme: {
    off: vi.fn(),
    on: vi.fn(),
    shouldUseDarkColors: false,
    themeSource: 'system' as string,
  },
}));

vi.mock('electron', () => ({
  nativeTheme: mockNativeTheme,
}));

vi.mock('@/const/dir', () => ({
  buildDir: '/mock/build',
}));

vi.mock('@/const/env', () => ({
  isDev: false,
  isLinux: false,
  isMac: true,
  isMacTahoe: false,
  isWindows: false,
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

describe('WindowThemeManager (macOS)', () => {
  let manager: WindowThemeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockNativeTheme.shouldUseDarkColors = false;
    mockNativeTheme.themeSource = 'system';
    mockBrowserWindow.isDestroyed.mockReturnValue(false);
    mockBrowserWindow.isFullScreen.mockReturnValue(false);

    manager = new WindowThemeManager('test-window');
  });

  afterEach(() => {
    manager.cleanup();
    vi.useRealTimers();
  });

  it('rebuilds the vibrancy when the theme changes in windowed mode', () => {
    manager.attach(mockBrowserWindow as any);
    mockBrowserWindow.setVibrancy.mockClear();

    manager.handleAppThemeChange();
    vi.runAllTimers();

    expect(mockBrowserWindow.setVibrancy).toHaveBeenNthCalledWith(1, null);
    expect(mockBrowserWindow.setVibrancy).toHaveBeenNthCalledWith(2, 'sidebar');
  });

  it('keeps an opaque background instead of vibrancy in fullscreen', () => {
    mockNativeTheme.shouldUseDarkColors = true;
    mockBrowserWindow.isFullScreen.mockReturnValue(true);

    manager.attach(mockBrowserWindow as any);
    mockBrowserWindow.setVibrancy.mockClear();

    manager.handleAppThemeChange();
    vi.runAllTimers();

    expect(mockBrowserWindow.setBackgroundColor).toHaveBeenLastCalledWith('#1a1a1a');
    expect(mockBrowserWindow.setVibrancy).toHaveBeenCalledWith(null);
    expect(mockBrowserWindow.setVibrancy).not.toHaveBeenCalledWith('sidebar');
  });
});
