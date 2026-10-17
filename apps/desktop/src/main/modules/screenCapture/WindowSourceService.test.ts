import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWindows = vi.fn();
const mockOpenWindowsSync = vi.fn();
const mockExecFileSync = vi.fn();
const mockElectronApp = vi.hoisted(() => ({ isPackaged: false }));
const originalPlatform = process.platform;
const originalResourcesPath = process.resourcesPath;

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'LobeHub'),
    get isPackaged() {
      return mockElectronApp.isPackaged;
    },
  },
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  execFileSync: mockExecFileSync,
}));

vi.mock('node-screenshots', () => ({
  Window: {
    all: mockWindows,
  },
}));

const mockIsScreenCaptureSupported = vi.fn(() => false);
const mockScreenShareableContent = vi.fn();

vi.mock('@lobechat/electron-mac-screen-capture', () => ({
  isSupported: mockIsScreenCaptureSupported,
  screenShareableContent: mockScreenShareableContent,
}));

vi.mock('get-windows', () => ({
  openWindowsSync: mockOpenWindowsSync,
}));

describe('WindowSourceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronApp.isPackaged = false;
    mockIsScreenCaptureSupported.mockReturnValue(false);
    mockScreenShareableContent.mockReturnValue(null);
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: originalResourcesPath,
    });
  });

  it('executes the unpacked get-windows helper in packaged macOS builds', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: '/Applications/LobeHub.app/Contents/Resources',
    });
    mockElectronApp.isPackaged = true;
    mockExecFileSync.mockReturnValue(JSON.stringify([{ owner: { processId: 42 } }]));
    mockWindows.mockReturnValue([]);

    const { enumerateWindows } = await import('./WindowSourceService');

    await enumerateWindows({ height: 1080, width: 1920, x: 0, y: 0 });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/Applications/LobeHub.app/Contents/Resources/app.asar.unpacked/node_modules/get-windows/main',
      ['--no-accessibility-permission', '--no-screen-recording-permission', '--open-windows-list'],
      { encoding: 'utf8' },
    );
    expect(mockOpenWindowsSync).not.toHaveBeenCalled();
  });

  it('normalizes window geometry to display DIPs on Windows high-DPI displays', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockOpenWindowsSync.mockReturnValue([{ owner: { processId: 42 } }]);
    mockWindows.mockReturnValue([
      {
        appName: () => 'Finder',
        height: () => 1200,
        id: () => 1001,
        isMinimized: () => false,
        pid: () => 42,
        title: () => 'Example',
        width: () => 1600,
        x: () => 400,
        y: () => 200,
        z: () => 10,
      },
    ]);

    const { enumerateWindows } = await import('./WindowSourceService');

    const windows = await enumerateWindows(
      {
        height: 1080,
        width: 1920,
        x: 0,
        y: 0,
      },
      1.5,
    );

    expect(windows).toEqual([
      {
        appName: 'Finder',
        bounds: {
          height: 800,
          width: 1066.6666666666667,
          x: 266.6666666666667,
          y: 133.33333333333334,
        },
        order: 0,
        overlayBounds: {
          height: 800,
          width: 1066.6666666666667,
          x: 266.6666666666667,
          y: 133.33333333333334,
        },
        title: 'Example',
        windowId: 1001,
      },
    ]);
  });

  it('preserves window geometry on retina displays without dividing by scale factor', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockOpenWindowsSync.mockReturnValue([{ owner: { processId: 42 } }]);
    mockWindows.mockReturnValue([
      {
        appName: () => 'Finder',
        height: () => 900,
        id: () => 1001,
        isMinimized: () => false,
        pid: () => 42,
        scaleFactor: () => 2,
        title: () => 'Example',
        width: () => 1440,
        x: () => 200,
        y: () => 100,
        z: () => 10,
      },
    ]);

    const { enumerateWindows } = await import('./WindowSourceService');

    const windows = await enumerateWindows({
      height: 1620,
      width: 2880,
      x: 0,
      y: 0,
    });

    expect(windows).toEqual([
      {
        appName: 'Finder',
        bounds: {
          height: 900,
          width: 1440,
          x: 200,
          y: 100,
        },
        order: 0,
        overlayBounds: {
          height: 900,
          width: 1440,
          x: 200,
          y: 100,
        },
        title: 'Example',
        windowId: 1001,
      },
    ]);
  });

  it('enumerates windows through ScreenCaptureKit, frontmost first, filtering the same way', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockIsScreenCaptureSupported.mockReturnValue(true);
    mockScreenShareableContent.mockReturnValue({
      displays: [],
      windows: [
        {
          appName: 'Finder',
          bundleId: 'com.apple.finder',
          frame: { height: 900, width: 1440, x: 200, y: 100 },
          isOnScreen: true,
          layer: 0,
          pid: 42,
          title: 'Example',
          windowID: 1001,
        },
        // System chrome and our own window are excluded, as before.
        {
          appName: 'Dock',
          bundleId: 'com.apple.dock',
          frame: { height: 900, width: 1440, x: 0, y: 0 },
          isOnScreen: true,
          layer: 20,
          pid: 11,
          title: '',
          windowID: 1002,
        },
        {
          appName: 'LobeHub',
          bundleId: 'com.lobehub.desktop',
          frame: { height: 900, width: 1440, x: 0, y: 0 },
          isOnScreen: true,
          layer: 0,
          pid: 99,
          title: 'LobeHub',
          windowID: 1003,
        },
        // Too small to be a real window.
        {
          appName: 'Finder',
          bundleId: 'com.apple.finder',
          frame: { height: 20, width: 20, x: 300, y: 300 },
          isOnScreen: true,
          layer: 0,
          pid: 42,
          title: 'Badge',
          windowID: 1004,
        },
        {
          appName: 'Safari',
          bundleId: 'com.apple.Safari',
          frame: { height: 700, width: 1200, x: 2600, y: 800 },
          isOnScreen: true,
          layer: 0,
          pid: 43,
          title: 'Docs',
          windowID: 1005,
        },
      ],
    });

    const { enumerateWindows } = await import('./WindowSourceService');

    const windows = await enumerateWindows({ height: 1620, width: 2880, x: 0, y: 0 });

    // Frontmost first, and the get-windows whitelist is not needed on this path.
    expect(windows.map((w) => [w.windowId, w.order])).toEqual([
      [1001, 0],
      [1005, 1],
    ]);
    expect(windows[1]).toMatchObject({
      appName: 'Safari',
      bounds: { height: 700, width: 1200, x: 2600, y: 800 },
      overlayBounds: { height: 700, width: 1200, x: 2600, y: 800 },
      title: 'Docs',
    });
    expect(mockWindows).not.toHaveBeenCalled();
    expect(mockOpenWindowsSync).not.toHaveBeenCalled();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('falls back to node-screenshots when ScreenCaptureKit has no content', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockIsScreenCaptureSupported.mockReturnValue(true);
    mockScreenShareableContent.mockReturnValue(null);
    mockOpenWindowsSync.mockReturnValue([{ owner: { processId: 42 } }]);
    mockWindows.mockReturnValue([
      {
        appName: () => 'Finder',
        height: () => 900,
        id: () => 1001,
        isMinimized: () => false,
        pid: () => 42,
        title: () => 'Example',
        width: () => 1440,
        x: () => 200,
        y: () => 100,
        z: () => 10,
      },
    ]);

    const { enumerateWindows } = await import('./WindowSourceService');

    const windows = await enumerateWindows({ height: 1620, width: 2880, x: 0, y: 0 });

    expect(windows.map((w) => w.windowId)).toEqual([1001]);
    expect(mockOpenWindowsSync).toHaveBeenCalled();
  });
});
