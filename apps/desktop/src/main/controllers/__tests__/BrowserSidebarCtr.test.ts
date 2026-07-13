import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { IpcHandler } from '@/utils/ipc/base';

import BrowserControlCtr from '../BrowserControlCtr';
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

/** A stand-in for a real app window (main app, or a standalone `chatSingle`). */
interface FakeWindow extends EventEmitter {
  contentView: {
    addChildView: ReturnType<typeof vi.fn>;
    removeChildView: ReturnType<typeof vi.fn>;
  };
  destroy: ReturnType<typeof vi.fn>;
  id: number;
  isDestroyed: () => boolean;
  /** The renderer webContents that sends IPC from this window. */
  sender: { id: number; isDestroyed: () => boolean };
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>;
  setOpacity: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  showInactive: ReturnType<typeof vi.fn>;
  webContents: { getZoomFactor: ReturnType<typeof vi.fn> };
}

let seq = 0;
const nextId = () => (seq += 1);

const createWebContents = (): FakeWebContents => {
  const wc = new EventEmitter() as FakeWebContents;
  // Track the loaded URL: the pool folds `getURL()` back into the page record, so
  // a fake that always answers the same URL hides which page is which.
  let url = 'about:blank';
  wc.id = nextId();
  wc.canGoBack = vi.fn(() => false);
  wc.canGoForward = vi.fn(() => false);
  wc.capturePage = vi.fn(async () => 'image');
  wc.close = vi.fn();
  wc.executeJavaScript = vi.fn(async () => undefined);
  wc.getTitle = vi.fn(() => 'Example');
  wc.getURL = vi.fn(() => url);
  wc.isDestroyed = vi.fn(() => false);
  wc.isLoading = vi.fn(() => false);
  wc.loadURL = vi.fn(async (next: string) => {
    url = next;
  });
  wc.reload = vi.fn();
  wc.setWindowOpenHandler = vi.fn();
  wc.stop = vi.fn();
  return wc;
};

const createWindow = (): FakeWindow => {
  let destroyed = false;
  const win = new EventEmitter() as FakeWindow;
  win.id = nextId();
  win.contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
  win.destroy = vi.fn(() => {
    destroyed = true;
    win.emit('closed');
  });
  win.isDestroyed = () => destroyed;
  win.sender = { id: nextId(), isDestroyed: () => destroyed };
  win.setIgnoreMouseEvents = vi.fn();
  win.setOpacity = vi.fn();
  win.setPosition = vi.fn();
  win.showInactive = vi.fn();
  win.webContents = { getZoomFactor: vi.fn(() => 1) };
  return win;
};

const {
  appOnMock,
  clipboardWriteImageMock,
  createdViews,
  createdWindows,
  fromWebContentsMock,
  getAllWindowsMock,
  importChromeLoginDataMock,
  ipcHandlers,
  ipcMainHandleMock,
  sessionFromPartitionMock,
  shellOpenExternalMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  return {
    appOnMock: vi.fn(),
    clipboardWriteImageMock: vi.fn(),
    createdViews: [] as unknown[],
    createdWindows: [] as unknown[],
    fromWebContentsMock: vi.fn(),
    getAllWindowsMock: vi.fn(() => [] as unknown[]),
    importChromeLoginDataMock: vi.fn(),
    ipcHandlers: handlers,
    ipcMainHandleMock: vi.fn(
      (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    ),
    sessionFromPartitionMock: vi.fn(),
    shellOpenExternalMock: vi.fn().mockResolvedValue(undefined),
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
      constructor() {
        return createdWindows.at(-1) as object;
      }
    },
    { fromWebContents: fromWebContentsMock, getAllWindows: getAllWindowsMock },
  ),
  clipboard: { writeImage: clipboardWriteImageMock },
  ipcMain: { handle: ipcMainHandleMock },
  session: { fromPartition: sessionFromPartitionMock },
  shell: { openExternal: shellOpenExternalMock },
  WebContentsView: class {
    constructor() {
      return createdViews.at(-1) as object;
    }
  },
}));

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
  const queueParkingWindow = (): FakeWindow => {
    const win = createWindow();
    createdWindows.push(win);
    return win;
  };

  /** An app window whose renderer can send IPC — the main one, or a standalone chat window. */
  const appWindow = (): FakeWindow => {
    const win = createWindow();
    fromWebContentsMock.mockImplementation((sender: unknown) =>
      [mainWindow, win].find((candidate) => candidate?.sender === sender),
    );
    return win;
  };

  /** Invoke an IPC channel as if it came from `from`'s renderer. */
  const invokeIpc = async <T = unknown>(
    channel: string,
    payload?: unknown,
    from: FakeWindow = mainWindow,
  ): Promise<T> => {
    const handler = ipcHandlers.get(channel);
    if (!handler) throw new Error(`IPC handler for ${channel} not found`);
    return handler({ sender: from.sender }, payload) as Promise<T>;
  };

  // BrowserControlCtr is wired in too, so the "a tool call keeps the page alive"
  // test exercises the real path (withGuest → touchPage) rather than a stand-in.
  const mockApp = () =>
    ({
      browserManager: { broadcastToAllWindows },
      getController: (Ctor: unknown) => (Ctor === BrowserSidebarCtr ? controller : undefined),
    }) as unknown as App;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcHandlers.clear();
    createdViews.length = 0;
    createdWindows.length = 0;
    seq = 0;
    (
      IpcHandler.getInstance() as unknown as { registeredChannels?: Set<string> }
    ).registeredChannels?.clear();

    sessionFromPartitionMock.mockReturnValue(mockSession);

    mainWindow = createWindow();
    fromWebContentsMock.mockImplementation((sender: unknown) =>
      mainWindow.sender === sender ? mainWindow : undefined,
    );

    const app = mockApp();
    controller = new BrowserSidebarCtr(app);
    controller.beforeAppReady();
    // Registers the browserControl.* channels against the same pool.

    new BrowserControlCtr(app);
  });

  it('creates a page and loads the URL on navigate, without any renderer round-trip', async () => {
    const view = queueView();
    queueParkingWindow();

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
    queueParkingWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    // agent:a is what the user is looking at.
    await invokeIpc('browserSidebar.setViewport', {
      rect: { height: 600, width: 400, x: 10, y: 20 },
      sessionId: 'agent:a',
    });
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(viewA);

    // A different agent navigates in the background.
    const viewB = queueView();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:b', url: 'https://b.com' });

    expect(viewB).not.toBe(viewA);
    expect(viewB.webContents.loadURL).toHaveBeenCalledWith('https://b.com');
    // The visible page was neither navigated again nor taken out of the window.
    expect(viewA.webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(mainWindow.contentView.removeChildView).not.toHaveBeenCalled();
  });

  it('hosts the view in the window that reported the rect, not the main window', async () => {
    // The agent route also renders in standalone `chatSingle` windows. Hosting in
    // the main window would leave the standalone panel blank and paint the page
    // over the wrong window.
    const standalone = appWindow();
    const view = queueView();
    queueParkingWindow();

    await invokeIpc(
      'browserSidebar.navigate',
      { sessionId: 'agent:a', url: 'https://a.com' },
      standalone,
    );
    await invokeIpc(
      'browserSidebar.setViewport',
      { rect: { height: 600, width: 400, x: 10, y: 20 }, sessionId: 'agent:a' },
      standalone,
    );

    expect(standalone.contentView.addChildView).toHaveBeenCalledWith(view);
    expect(mainWindow.contentView.addChildView).not.toHaveBeenCalled();
  });

  it('lets two windows each show a page at the same time', async () => {
    const standalone = appWindow();
    const viewA = queueView();
    const parking = queueParkingWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });
    await invokeIpc('browserSidebar.setViewport', {
      rect: { height: 600, width: 400, x: 0, y: 0 },
      sessionId: 'agent:a',
    });

    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(viewA);
    // Every page is born in the parking lot, so only calls from here on say
    // anything about whether showing B parked A.
    parking.contentView.addChildView.mockClear();

    const viewB = queueView();
    await invokeIpc(
      'browserSidebar.navigate',
      { sessionId: 'agent:b', url: 'https://b.com' },
      standalone,
    );
    await invokeIpc(
      'browserSidebar.setViewport',
      { rect: { height: 600, width: 400, x: 0, y: 0 }, sessionId: 'agent:b' },
      standalone,
    );

    expect(standalone.contentView.addChildView).toHaveBeenCalledWith(viewB);
    // Showing B in another window must not park A — display is per-window.
    expect(parking.contentView.addChildView).not.toHaveBeenCalledWith(viewA);
    expect(mainWindow.contentView.removeChildView).not.toHaveBeenCalled();
  });

  it('reclaims the page when a window that lost it regains focus', async () => {
    // One session can be open in two windows (main + its standalone chat window)
    // but there is only one page. The window that loses it never re-reports — its
    // rect didn't change — so without this its panel stays empty forever.
    const standalone = appWindow();
    const view = queueView();
    queueParkingWindow();

    const rect = { height: 600, width: 400, x: 0, y: 0 };
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });
    await invokeIpc('browserSidebar.setViewport', { rect, sessionId: 'agent:a' });
    await invokeIpc('browserSidebar.setViewport', { rect, sessionId: 'agent:a' }, standalone);

    expect(standalone.contentView.addChildView).toHaveBeenCalledWith(view);
    mainWindow.contentView.addChildView.mockClear();

    mainWindow.emit('focus');

    expect(standalone.contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(view);
  });

  it('parks a page when its host window closes, instead of letting it die with the window', async () => {
    // Child views are destroyed with the window that holds them, so a page shown
    // in a standalone chat window would be torn down when the user closes it —
    // even if an agent is still driving it.
    const standalone = appWindow();
    const view = queueView();
    const parking = queueParkingWindow();

    await invokeIpc(
      'browserSidebar.navigate',
      { sessionId: 'agent:a', url: 'https://a.com' },
      standalone,
    );
    await invokeIpc(
      'browserSidebar.setViewport',
      { rect: { height: 600, width: 400, x: 0, y: 0 }, sessionId: 'agent:a' },
      standalone,
    );
    parking.contentView.addChildView.mockClear();

    standalone.emit('close');

    expect(standalone.contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(parking.contentView.addChildView).toHaveBeenCalledWith(view);
    expect(view.webContents.close).not.toHaveBeenCalled();
  });

  it('parks a page instead of destroying it when the panel stops showing it', async () => {
    const view = queueView();
    const parking = queueParkingWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    await invokeIpc('browserSidebar.setViewport', {
      rect: { height: 600, width: 400, x: 0, y: 0 },
      sessionId: 'agent:a',
    });
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(view);
    parking.contentView.addChildView.mockClear();

    // A zero-sized rect is what `display: none` reports when another tab is active.
    await invokeIpc('browserSidebar.setViewport', {
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
    queueParkingWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    // The renderer reports CSS px; setBounds wants DIP. At zoom 1.25 the page
    // would otherwise be laid out 25% too small and offset from the panel.
    mainWindow.webContents.getZoomFactor.mockReturnValue(1.25);
    await invokeIpc('browserSidebar.setViewport', {
      rect: { height: 400, width: 200, x: 100, y: 40 },
      sessionId: 'agent:a',
    });

    expect(view.setBounds).toHaveBeenLastCalledWith({ height: 500, width: 250, x: 125, y: 50 });
  });

  it('keeps the parking window shown but fully transparent', async () => {
    queueView();
    const parking = queueParkingWindow();

    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    // It must be SHOWN — `show: false` leaves its pages with no compositing
    // surface, which is the whole reason this window exists.
    expect(parking.showInactive).toHaveBeenCalled();
    // And invisible by opacity, not by position: the OS clamps a window it thinks
    // is reachable (macOS dragged -8000,-8000 back to the screen edge, where a
    // plain white window showed up over the app).
    expect(parking.setOpacity).toHaveBeenCalledWith(0);
    expect(parking.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    const [x, y] = parking.setPosition.mock.calls[0];
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
  });

  it('destroys the parking window once the last app window closes, so `window-all-closed` can fire', async () => {
    queueView();
    const parking = queueParkingWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    // The controller watches every window Electron creates.
    const onWindowCreated = appOnMock.mock.calls.find(
      ([event]) => event === 'browser-window-created',
    )?.[1];
    onWindowCreated({}, mainWindow);

    // Last app window gone; only the pool's own parking window is left standing.
    getAllWindowsMock.mockReturnValue([parking]);
    mainWindow.destroy();

    expect(parking.destroy).toHaveBeenCalled();
  });

  describe('memory cap', () => {
    // Each live page is a full renderer process (90–345 MB measured), so the pool
    // is capped. These pin what may and may not be thrown away.
    const navigateN = async (count: number, from = 0) => {
      const views: FakeView[] = [];
      for (let i = from; i < from + count; i += 1) {
        views.push(queueView());

        await invokeIpc('browserSidebar.navigate', {
          sessionId: `agent:${i}`,
          url: `https://site-${i}.com`,
        });
      }
      return views;
    };

    it('discards the coldest idle page once the pool is over its cap', async () => {
      vi.useFakeTimers();
      queueParkingWindow();

      const views = await navigateN(6);
      // Age them past the in-use window so they are eligible.
      vi.advanceTimersByTime(120_000);

      queueView();
      await invokeIpc('browserSidebar.navigate', {
        sessionId: 'agent:6',
        url: 'https://site-6.com',
      });

      // agent:0 was the coldest.
      expect(views[0].webContents.close).toHaveBeenCalled();
      expect(views[1].webContents.close).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('keeps a discarded page addressable, and reloads it where it left off', async () => {
      vi.useFakeTimers();
      queueParkingWindow();
      const views = await navigateN(6);
      vi.advanceTimersByTime(120_000);

      queueView();
      await invokeIpc('browserSidebar.navigate', {
        sessionId: 'agent:6',
        url: 'https://site-6.com',
      });
      expect(views[0].webContents.close).toHaveBeenCalled();

      // The panel still knows where that session was.
      const state = await invokeIpc<{ attached: boolean; url: string }>('browserSidebar.getState', {
        sessionId: 'agent:0',
      });
      expect(state.url).toBe('https://site-0.com');
      expect(state.attached).toBe(false);

      // Coming back rebuilds the view on the same URL rather than a blank page.
      const revived = queueView();
      await invokeIpc('browserSidebar.setViewport', {
        rect: { height: 600, width: 400, x: 0, y: 0 },
        sessionId: 'agent:0',
      });
      expect(revived.webContents.loadURL).toHaveBeenCalledWith('https://site-0.com');
      vi.useRealTimers();
    });

    it('never discards a page an agent is still driving, even over the cap', async () => {
      vi.useFakeTimers();
      queueParkingWindow();
      const views = await navigateN(6);
      vi.advanceTimersByTime(120_000);

      // A tool call on the coldest page counts as use.
      await invokeIpc('browserControl.snapshot', { sessionId: 'agent:0' });

      queueView();
      await invokeIpc('browserSidebar.navigate', {
        sessionId: 'agent:6',
        url: 'https://site-6.com',
      });

      // agent:0 is in use, so agent:1 — the next coldest — goes instead.
      expect(views[0].webContents.close).not.toHaveBeenCalled();
      expect(views[1].webContents.close).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('sweeps back down to the cap after a burst goes idle, with no new page to trigger it', async () => {
      // The real failure this guards: 10 agents open pages at once, so nothing is
      // evictable (all "in use") — and if eviction only ran on create, the pool
      // would stay at 10 forever. Verified against the live app.
      vi.useFakeTimers();
      queueParkingWindow();
      const views = await navigateN(10);

      // Nothing is evictable yet: everything was just used.
      for (const view of views) expect(view.webContents.close).not.toHaveBeenCalled();

      // Nobody creates another page — the sweep has to do it.
      await vi.advanceTimersByTimeAsync(150_000);

      const closed = views.filter((view) => view.webContents.close.mock.calls.length > 0);
      expect(closed).toHaveLength(4);
      // Oldest first: agent:0..3 go, agent:6..9 stay.
      expect(views[0].webContents.close).toHaveBeenCalled();
      expect(views[3].webContents.close).toHaveBeenCalled();
      expect(views[9].webContents.close).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('stays over the cap rather than discard a page that is on screen or in use', async () => {
      vi.useFakeTimers();
      queueParkingWindow();
      const views = await navigateN(6);
      // No time passes: every page is within the in-use window.

      queueView();
      await invokeIpc('browserSidebar.navigate', {
        sessionId: 'agent:6',
        url: 'https://site-6.com',
      });

      for (const view of views) expect(view.webContents.close).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  it('keeps window.open navigations inside the page', async () => {
    const view = queueView();
    queueParkingWindow();
    await invokeIpc('browserSidebar.navigate', { sessionId: 'agent:a', url: 'https://a.com' });

    const handler = view.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(handler({ url: 'https://popup.example.com' })).toEqual({ action: 'deny' });
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://popup.example.com');
  });

  it('sends free text to a search engine rather than navigating to it', async () => {
    const view = queueView();
    queueParkingWindow();

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
