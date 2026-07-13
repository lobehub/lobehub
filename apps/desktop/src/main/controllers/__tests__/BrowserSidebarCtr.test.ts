import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { IpcHandler } from '@/utils/ipc/base';

import BrowserSidebarCtr from '../BrowserSidebarCtr';

interface FakeWebContents extends EventEmitter {
  canGoBack: ReturnType<typeof vi.fn>;
  canGoForward: ReturnType<typeof vi.fn>;
  capturePage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
  getTitle: ReturnType<typeof vi.fn>;
  getURL: ReturnType<typeof vi.fn>;
  id: number;
  isDestroyed: ReturnType<typeof vi.fn>;
  isLoading: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface FakeView {
  setBounds: ReturnType<typeof vi.fn>;
  webContents: FakeWebContents;
}

interface FakeWindow {
  contentView: {
    addChildView: ReturnType<typeof vi.fn>;
    removeChildView: ReturnType<typeof vi.fn>;
  };
  destroy: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
  once: ReturnType<typeof vi.fn>;
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  showInactive: ReturnType<typeof vi.fn>;
  webContents: { getZoomFactor: ReturnType<typeof vi.fn> };
}

let viewSeq = 0;

const createWebContents = (): FakeWebContents => {
  viewSeq += 1;
  const wc = new EventEmitter() as FakeWebContents;
  wc.id = viewSeq;
  wc.canGoBack = vi.fn(() => false);
  wc.canGoForward = vi.fn(() => false);
  wc.capturePage = vi.fn(async () => 'image');
  wc.close = vi.fn();
  wc.executeJavaScript = vi.fn(async () => undefined);
  wc.getTitle = vi.fn(() => 'Example');
  wc.getURL = vi.fn(() => 'https://example.com');
  wc.isDestroyed = vi.fn(() => false);
  wc.isLoading = vi.fn(() => false);
  wc.loadURL = vi.fn(async () => undefined);
  wc.reload = vi.fn();
  wc.setWindowOpenHandler = vi.fn();
  wc.stop = vi.fn();
  return wc;
};

const createWindow = (zoomFactor = 1): FakeWindow => {
  let destroyed = false;
  return {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    isDestroyed: () => destroyed,
    once: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setPosition: vi.fn(),
    showInactive: vi.fn(),
    webContents: { getZoomFactor: vi.fn(() => zoomFactor) },
  };
};

const {
  appOnMock,
  browserWindowCtorMock,
  clipboardWriteImageMock,
  createdViews,
  createdWindows,
  importChromeLoginDataMock,
  ipcHandlers,
  ipcMainHandleMock,
  sessionFromPartitionMock,
  shellOpenExternalMock,
  webContentsViewCtorMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  return {
    appOnMock: vi.fn(),
    browserWindowCtorMock: vi.fn(),
    clipboardWriteImageMock: vi.fn(),
    createdViews: [] as unknown[],
    createdWindows: [] as unknown[],
    importChromeLoginDataMock: vi.fn(),
    ipcHandlers: handlers,
    ipcMainHandleMock: vi.fn(
      (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    ),
    sessionFromPartitionMock: vi.fn(),
    shellOpenExternalMock: vi.fn().mockResolvedValue(undefined),
    webContentsViewCtorMock: vi.fn(),
  };
});

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@/modules/browser/importChromeLoginData', () => ({
  importChromeLoginData: importChromeLoginDataMock,
}));

vi.mock('electron', () => ({
  app: { on: appOnMock },
  BrowserWindow: Object.assign(
    class {
      constructor(opts: Record<string, unknown>) {
        browserWindowCtorMock(opts);

        return createdWindows.at(-1) as object;
      }
    },
    { fromWebContents: vi.fn() },
  ),
  clipboard: { writeImage: clipboardWriteImageMock },
  ipcMain: { handle: ipcMainHandleMock },
  session: { fromPartition: sessionFromPartitionMock },
  shell: { openExternal: shellOpenExternalMock },
  WebContentsView: class {
    constructor(opts: Record<string, unknown>) {
      webContentsViewCtorMock(opts);

      return createdViews.at(-1) as object;
    }
  },
}));

const invokeIpc = async <T = unknown>(channel: string, payload?: unknown): Promise<T> => {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`IPC handler for ${channel} not found`);
  return handler({ sender: { id: 'test' } }, payload) as Promise<T>;
};

describe('BrowserSidebarCtr', () => {
  const broadcastToAllWindows = vi.fn();
  const mockSession = {
    on: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
  };

  let mainWindow: FakeWindow;
  let controller: BrowserSidebarCtr;

  /** Hand out a fresh fake for the next `new WebContentsView()`. */
  const queueView = (): FakeView => {
    const view: FakeView = { setBounds: vi.fn(), webContents: createWebContents() };
    createdViews.push(view);
    return view;
  };

  /** Hand out a fresh fake for the next `new BrowserWindow()` (the parking lot). */
  const queueWindow = (): FakeWindow => {
    const win = createWindow();
    createdWindows.push(win);
    return win;
  };

  const mockApp = () =>
    ({
      browserManager: {
        broadcastToAllWindows,
        browsers: new Map([['app', { webContents: { isDestroyed: () => false } }]]),
      },
    }) as unknown as App;

  beforeEach(async () => {
    vi.clearAllMocks();
    ipcHandlers.clear();
    createdViews.length = 0;
    createdWindows.length = 0;
    viewSeq = 0;
    (
      IpcHandler.getInstance() as unknown as { registeredChannels?: Set<string> }
    ).registeredChannels?.clear();

    sessionFromPartitionMock.mockReturnValue(mockSession);

    mainWindow = createWindow();
    const { BrowserWindow } = await import('electron');
    (BrowserWindow.fromWebContents as ReturnType<typeof vi.fn>).mockReturnValue(mainWindow);

    controller = new BrowserSidebarCtr(mockApp());
    controller.beforeAppReady();
  });

  it('creates a page and loads the URL on navigate, without any renderer round-trip', async () => {
    const view = queueView();
    queueWindow();

    const result = await invokeIpc('browserSidebar.navigate', {
      sessionId: 'agent:a',
      url: 'https://example.com',
    });

    expect(result).toEqual({ success: true });
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://example.com');
    expect(broadcastToAllWindows).toHaveBeenCalledWith(
      'browserSidebarStateChanged',
      expect.objectContaining({ attached: true, sessionId: 'agent:a' }),
    );
  });

  it('gives each session its own page, so a background agent never drives the visible one', async () => {
    const viewA = queueView();
    queueWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    // agent:a is what the user is looking at.
    invokeIpc('browserSidebar.setViewport', {
      rect: { height: 600, width: 400, x: 10, y: 20 },
      sessionId: 'agent:a',
    });
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(viewA);

    // A different agent navigates in the background.
    const viewB = queueView();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:b', url: 'https://b.com' });

    expect(viewB).not.toBe(viewA);
    expect(viewB.webContents.loadURL).toHaveBeenCalledWith('https://b.com');
    // The visible page was neither navigated again nor removed from the window.
    expect(viewA.webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(mainWindow.contentView.removeChildView).not.toHaveBeenCalled();
  });

  it('parks a page instead of destroying it when the panel stops showing it', async () => {
    const view = queueView();
    const parking = queueWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    invokeIpc('browserSidebar.setViewport', {
      rect: { height: 600, width: 400, x: 0, y: 0 },
      sessionId: 'agent:a',
    });
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(view);

    // A zero-sized rect is what `display: none` reports when another tab is active.
    invokeIpc('browserSidebar.setViewport', {
      rect: { height: 0, width: 0, x: 0, y: 0 },
      sessionId: 'agent:a',
    });

    expect(mainWindow.contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(parking.contentView.addChildView).toHaveBeenCalledWith(view);
    // Still live — the agent may still be driving it.
    expect(view.webContents.close).not.toHaveBeenCalled();
  });

  it('scales the panel rect by the app zoom factor', async () => {
    const view = queueView();
    queueWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    // The renderer reports CSS px; setBounds wants DIP. At zoom 1.25 the page
    // would otherwise be laid out 25% too small and offset from the panel.
    mainWindow.webContents.getZoomFactor.mockReturnValue(1.25);
    invokeIpc('browserSidebar.setViewport', {
      rect: { height: 400, width: 200, x: 100, y: 40 },
      sessionId: 'agent:a',
    });

    expect(view.setBounds).toHaveBeenLastCalledWith({ height: 500, width: 250, x: 125, y: 50 });
  });

  it('shows the parking window: a `show: false` window would leave its pages with no compositing surface', async () => {
    queueView();
    const parking = queueWindow();

    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    expect(parking.showInactive).toHaveBeenCalled();
    expect(parking.setPosition).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    const [x, y] = parking.setPosition.mock.calls[0];
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
  });

  it('destroys the parking window on quit, so `window-all-closed` can still fire', async () => {
    queueView();
    const parking = queueWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    const beforeQuit = appOnMock.mock.calls.find(([event]) => event === 'before-quit')?.[1];
    expect(beforeQuit).toBeTypeOf('function');
    beforeQuit();

    expect(parking.destroy).toHaveBeenCalled();
  });

  it('keeps window.open navigations inside the page', async () => {
    const view = queueView();
    queueWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    const handler = view.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(handler({ url: 'https://popup.example.com' })).toEqual({ action: 'deny' });
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://popup.example.com');
  });

  it('sends free text to a search engine rather than navigating to it', async () => {
    const view = queueView();
    queueWindow();

    await invokeIpc('browserSidebar.navigate', {
      sessionId: 'agent:a',
      url: 'how tall is everest',
    });

    expect(view.webContents.loadURL).toHaveBeenCalledWith(
      expect.stringContaining('bing.com/search?q=how+tall+is+everest'),
    );
  });

  it('imports Chrome login information into the browser session', async () => {
    importChromeLoginDataMock.mockResolvedValue(7);

    const result = await invokeIpc('browserSidebar.importChromeLoginData');

    expect(sessionFromPartitionMock).toHaveBeenCalledWith('persist:lobe-browser-app');
    expect(result).toEqual({ importedCount: 7, success: true });
  });

  it('returns a recoverable error when Chrome login import fails', async () => {
    importChromeLoginDataMock.mockRejectedValue(new Error('locked'));

    const result = await invokeIpc('browserSidebar.importChromeLoginData');

    expect(result).toEqual({ error: 'locked', importedCount: 0, success: false });
  });
});
