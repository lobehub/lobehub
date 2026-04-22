import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScreenCaptureManager } from './ScreenCaptureManager';

const {
  mockBrowserWindow,
  MockBrowserWindow,
  mockScreen,
  mockEnumerateWindows,
  mockIsMac,
  mockCaptureWindow,
  mockCaptureRect,
} = vi.hoisted(() => {
  const mockBrowserWindow = {
    destroy: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    loadURL: vi.fn().mockResolvedValue(undefined),
    moveTop: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setHiddenInMissionControl: vi.fn(),
    setOpacity: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    show: vi.fn(),
    webContents: {
      on: vi.fn(),
      once: vi.fn((_event, listener) => {
        listener();
      }),
      send: vi.fn(),
    },
  };

  return {
    mockBrowserWindow,
    MockBrowserWindow: vi.fn(() => mockBrowserWindow),
    mockCaptureRect: vi.fn(),
    mockCaptureWindow: vi.fn(),
    mockEnumerateWindows: vi.fn().mockResolvedValue([]),
    mockIsMac: { value: true },
    mockScreen: {
      getCursorScreenPoint: vi.fn(() => ({ x: 10, y: 10 })),
      getDisplayNearestPoint: vi.fn(() => ({
        bounds: { height: 900, width: 1440, x: 0, y: 0 },
        id: 1,
        scaleFactor: 2,
      })),
    },
  };
});

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  screen: mockScreen,
}));

vi.mock('@/const/dir', () => ({
  preloadDir: '/mock/preload',
}));

vi.mock('@/const/env', () => ({
  get isMac() {
    return mockIsMac.value;
  },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('./WindowSourceService', () => ({
  enumerateWindows: mockEnumerateWindows,
}));

vi.mock('./CaptureService', () => ({
  captureRect: (...args: unknown[]) => mockCaptureRect(...args),
  captureWindow: (...args: unknown[]) => mockCaptureWindow(...args),
}));

describe('ScreenCaptureManager', () => {
  const createApp = () =>
    ({
      browserManager: {
        broadcastToAllWindows: vi.fn(),
        broadcastToWindow: vi.fn(),
        showMainWindow: vi.fn(),
      },
      buildRendererUrl: vi.fn().mockResolvedValue('http://localhost:5173/overlay'),
    }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowserWindow.isDestroyed.mockReturnValue(false);
    mockEnumerateWindows.mockResolvedValue([]);
    mockIsMac.value = true;
  });

  it('keeps the app in regular mode when showing overlay on macOS', async () => {
    const manager = new ScreenCaptureManager(createApp());

    await manager.startSession();

    expect(mockBrowserWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      skipTransformProcessType: true,
      visibleOnFullScreen: true,
    });
  });

  it('focuses the overlay after showing it', async () => {
    const manager = new ScreenCaptureManager(createApp());

    await manager.startSession();

    expect(mockBrowserWindow.show).toHaveBeenCalled();
    expect(mockBrowserWindow.focus).toHaveBeenCalled();
    expect(mockBrowserWindow.moveTop).toHaveBeenCalled();
  });

  describe('preview handlers', () => {
    it('hides overlay via opacity while capturing rect and restores after', async () => {
      const app = createApp();
      const manager = new ScreenCaptureManager(app);
      await manager.startSession();

      const pngBuffer = Buffer.from([1, 2, 3, 4]);
      mockCaptureRect.mockResolvedValue(pngBuffer);

      const result = await manager.handlePreviewRect({ height: 50, width: 100, x: 10, y: 20 });

      expect(result.success).toBe(true);
      expect(result.captureId).toEqual(expect.any(String));
      expect(result.dataUrl).toBe(`data:image/png;base64,${pngBuffer.toString('base64')}`);
      expect(mockBrowserWindow.setOpacity).toHaveBeenCalledWith(0);
      expect(mockBrowserWindow.setOpacity).toHaveBeenLastCalledWith(1);
      expect(mockCaptureRect).toHaveBeenCalledWith({ height: 50, width: 100, x: 10, y: 20 }, 2, {
        height: 900,
        width: 1440,
        x: 0,
        y: 0,
      });
      expect(app.browserManager.broadcastToWindow).toHaveBeenCalledWith(
        'app',
        'overlayUploadRequest',
        expect.objectContaining({
          captureId: result.captureId,
          filename: `screen-capture-${result.captureId}.png`,
          mimeType: 'image/png',
        }),
      );
    });

    it('returns failure when previewRect has no session', async () => {
      const manager = new ScreenCaptureManager(createApp());

      const result = await manager.handlePreviewRect({ height: 50, width: 100, x: 10, y: 20 });

      expect(result.success).toBe(false);
      expect(mockCaptureRect).not.toHaveBeenCalled();
    });

    it('returns dataUrl after previewWindow and attaches window bounds', async () => {
      mockEnumerateWindows.mockResolvedValue([
        {
          appName: 'Safari',
          bounds: { height: 200, width: 300, x: 5, y: 6 },
          order: 0,
          overlayBounds: { height: 200, width: 300, x: 5, y: 6 },
          title: 'Docs',
          windowId: 42,
        },
      ]);
      const app = createApp();
      const manager = new ScreenCaptureManager(app);
      await manager.startSession();

      const pngBuffer = Buffer.from([9, 9, 9]);
      mockCaptureWindow.mockResolvedValue(pngBuffer);

      const result = await manager.handlePreviewWindow(42);

      expect(result.success).toBe(true);
      expect(result.captureId).toEqual(expect.any(String));
      expect(result.dataUrl).toBe(`data:image/png;base64,${pngBuffer.toString('base64')}`);
      expect(result.rect).toEqual({ height: 200, width: 300, x: 5, y: 6 });
      expect(mockCaptureWindow).toHaveBeenCalledWith(42);
      expect(app.browserManager.broadcastToWindow).toHaveBeenCalledWith(
        'app',
        'overlayUploadRequest',
        expect.objectContaining({ captureId: result.captureId }),
      );
    });

    it('restores opacity even when capture fails', async () => {
      const manager = new ScreenCaptureManager(createApp());
      await manager.startSession();

      mockCaptureRect.mockResolvedValue(null);

      const result = await manager.handlePreviewRect({ height: 50, width: 100, x: 10, y: 20 });

      expect(result.success).toBe(false);
      expect(mockBrowserWindow.setOpacity).toHaveBeenLastCalledWith(1);
    });
  });

  describe('submit', () => {
    it('closes overlay on submit', async () => {
      const manager = new ScreenCaptureManager(createApp());
      await manager.startSession();

      await manager.handleSubmit({
        captureIds: ['capture-1'],
        prompt: 'hello',
      });

      expect(mockBrowserWindow.destroy).toHaveBeenCalled();
    });
  });

  describe('reportUploadStatus', () => {
    it('forwards status updates to the overlay after a preview', async () => {
      const manager = new ScreenCaptureManager(createApp());
      await manager.startSession();

      const pngBuffer = Buffer.from([1, 2, 3]);
      mockCaptureRect.mockResolvedValue(pngBuffer);
      const result = await manager.handlePreviewRect({ height: 50, width: 100, x: 0, y: 0 });
      expect(result.captureId).toBeTruthy();

      mockBrowserWindow.webContents.send.mockClear();
      manager.reportUploadStatus({
        captureId: result.captureId!,
        fileId: 'file-1',
        status: 'ready',
      });

      expect(mockBrowserWindow.webContents.send).toHaveBeenCalledWith(
        'overlayCaptureUploadStatus',
        { captureId: result.captureId, fileId: 'file-1', status: 'ready' },
      );
    });

    it('ignores status updates for unknown captureIds', async () => {
      const manager = new ScreenCaptureManager(createApp());
      await manager.startSession();

      mockBrowserWindow.webContents.send.mockClear();
      manager.reportUploadStatus({ captureId: 'unknown', status: 'ready' });

      expect(mockBrowserWindow.webContents.send).not.toHaveBeenCalledWith(
        'overlayCaptureUploadStatus',
        expect.anything(),
      );
    });
  });
});
