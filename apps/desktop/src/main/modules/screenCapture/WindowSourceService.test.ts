import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWindows = vi.fn();
const mockOpenWindowsSync = vi.fn();
const originalPlatform = process.platform;

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'LobeHub'),
  },
}));

vi.mock('node-screenshots', () => ({
  Window: {
    all: mockWindows,
  },
}));

vi.mock('get-windows', () => ({
  openWindowsSync: mockOpenWindowsSync,
}));

describe('WindowSourceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
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
});
