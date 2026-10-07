import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { IpcHandler } from '@/utils/ipc/base';

import BrowserSidebarCtr from '../BrowserSidebarCtr';

interface FakeWebContents extends EventEmitter {
  canGoBack: ReturnType<typeof vi.fn>;
  canGoForward: ReturnType<typeof vi.fn>;
  getTitle: ReturnType<typeof vi.fn>;
  getURL: ReturnType<typeof vi.fn>;
  id: number;
  isDestroyed: ReturnType<typeof vi.fn>;
  isLoading: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
}

const { fromIdMock, ipcHandlers, ipcMainHandleMock, sessionFromPartitionMock } = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  return {
    fromIdMock: vi.fn(),
    ipcHandlers: handlers,
    ipcMainHandleMock: vi.fn(
      (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
        handlers.set(channel, handler);
      },
    ),
    sessionFromPartitionMock: vi.fn(),
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
  session: { fromPartition: sessionFromPartitionMock },
  shell: { openExternal: vi.fn() },
  webContents: { fromId: fromIdMock },
}));

const createWebContents = (id: number): FakeWebContents => {
  const webContents = new EventEmitter() as FakeWebContents;
  let url = 'about:blank';
  webContents.id = id;
  webContents.canGoBack = vi.fn(() => false);
  webContents.canGoForward = vi.fn(() => false);
  webContents.getTitle = vi.fn(() => 'Example');
  webContents.getURL = vi.fn(() => url);
  webContents.isDestroyed = vi.fn(() => false);
  webContents.isLoading = vi.fn(() => false);
  webContents.loadURL = vi.fn(async (nextUrl: string) => {
    url = nextUrl;
  });
  webContents.setWindowOpenHandler = vi.fn();
  return webContents;
};

describe('BrowserSidebarCtr retained webview registration', () => {
  const broadcastToAllWindows = vi.fn();
  const browserSession = {
    on: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
  };

  let controller: BrowserSidebarCtr;

  const invokeIpc = async <T>(channel: string, payload: unknown): Promise<T> => {
    const handler = ipcHandlers.get(channel);
    if (!handler) throw new Error(`IPC handler for ${channel} not found`);
    return handler({ sender: {} }, payload) as Promise<T>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ipcHandlers.clear();
    (
      IpcHandler.getInstance() as unknown as { registeredChannels?: Set<string> }
    ).registeredChannels?.clear();
    sessionFromPartitionMock.mockReturnValue(browserSession);

    controller = new BrowserSidebarCtr({
      browserManager: { broadcastToAllWindows },
    } as unknown as App);
    controller.afterAppReady();
  });

  it('returns a recoverable error until a renderer guest registers', async () => {
    await expect(
      invokeIpc('browserSidebar.navigate', {
        sessionId: 'topic:a',
        url: 'https://example.com',
      }),
    ).resolves.toEqual({ error: 'Browser is not ready', success: false });
  });

  it('routes navigation to the registered retained webview', async () => {
    const guest = createWebContents(7);
    fromIdMock.mockImplementation((id: number) => (id === 7 ? guest : undefined));

    await invokeIpc('browserSidebar.registerWebview', {
      sessionId: 'topic:a',
      webContentsId: 7,
    });
    await expect(
      invokeIpc('browserSidebar.navigate', {
        sessionId: 'topic:a',
        url: 'https://example.com',
      }),
    ).resolves.toEqual({ success: true });

    expect(guest.loadURL).toHaveBeenCalledWith('https://example.com');
    expect(broadcastToAllWindows).toHaveBeenCalledWith(
      'browserSidebarStateChanged',
      expect.objectContaining({ attached: true, sessionId: 'topic:a' }),
    );
  });

  describe('navigate outcome', () => {
    const register = async (guest: FakeWebContents) => {
      fromIdMock.mockImplementation((id: number) => (id === guest.id ? guest : undefined));
      await invokeIpc('browserSidebar.registerWebview', {
        sessionId: 'topic:a',
        webContentsId: guest.id,
      });
    };

    it('stops waiting for a page whose load never finishes', async () => {
      vi.useFakeTimers();
      const guest = createWebContents(7);
      // The document commits, but a request on it never completes: loadURL
      // never settles.
      guest.loadURL = vi.fn((nextUrl: string) => {
        guest.getURL.mockReturnValue(nextUrl);
        guest.emit('did-navigate', {}, nextUrl);
        return new Promise(() => {});
      });
      await register(guest);

      const pending = invokeIpc('browserSidebar.navigate', {
        sessionId: 'topic:a',
        url: 'http://127.0.0.1:9876/',
      });
      await vi.advanceTimersByTimeAsync(15_000);

      await expect(pending).resolves.toEqual({ success: true });
      vi.useRealTimers();
    });

    it('does not report success while the requested document has not committed', async () => {
      vi.useFakeTimers();
      const guest = createWebContents(7);
      guest.getURL.mockReturnValue('http://127.0.0.1:16001/');
      // The server has not answered yet: nothing commits, loadURL never settles.
      guest.loadURL = vi.fn(() => new Promise(() => {}));
      await register(guest);

      const pending = invokeIpc('browserSidebar.navigate', {
        sessionId: 'topic:a',
        url: 'http://127.0.0.1:18748/',
      });
      await vi.advanceTimersByTimeAsync(15_000);

      await expect(pending).resolves.toEqual({
        error:
          'http://127.0.0.1:18748/ has not responded within 15s, so the browser is still showing http://127.0.0.1:16001/. The load continues in the background — check with readPage or snapshot before acting on the page, or navigate again.',
        success: false,
      });
      expect(guest.listenerCount('did-navigate')).toBe(1);
      vi.useRealTimers();
    });

    it('ignores in-page navigations of the old page while the requested one is pending', async () => {
      vi.useFakeTimers();
      const guest = createWebContents(7);
      guest.getURL.mockReturnValue('http://127.0.0.1:16001/');
      // The old SPA changes its hash / pushState while the new server is still
      // silent: that is not the requested document committing.
      guest.loadURL = vi.fn(() => {
        guest.emit('did-navigate-in-page', {}, 'http://127.0.0.1:16001/#tab', true);
        return new Promise(() => {});
      });
      await register(guest);

      const pending = invokeIpc('browserSidebar.navigate', {
        sessionId: 'topic:a',
        url: 'http://127.0.0.1:18748/',
      });
      await vi.advanceTimersByTimeAsync(15_000);

      await expect(pending).resolves.toMatchObject({ success: false });
      vi.useRealTimers();
    });

    it('reports a navigation that left the requested page unopened', async () => {
      const guest = createWebContents(7);
      guest.getURL.mockReturnValue('http://127.0.0.1:16001/');
      // A 204 / download / refused connection rejects without committing.
      guest.loadURL = vi.fn(async () => {
        throw Object.assign(new Error("ERR_FAILED (-2) loading 'http://127.0.0.1:18748/'"), {
          errno: -2,
        });
      });
      await register(guest);

      await expect(
        invokeIpc('browserSidebar.navigate', {
          sessionId: 'topic:a',
          url: 'http://127.0.0.1:18748/',
        }),
      ).resolves.toEqual({
        error:
          "Could not open http://127.0.0.1:18748/: ERR_FAILED (-2) loading 'http://127.0.0.1:18748/'. The browser is still showing http://127.0.0.1:16001/.",
        success: false,
      });
    });

    it('says an error page is showing when the failed URL committed', async () => {
      const guest = createWebContents(7);
      guest.loadURL = vi.fn(async (nextUrl: string) => {
        guest.getURL.mockReturnValue(nextUrl);
        throw Object.assign(new Error('ERR_CONNECTION_REFUSED (-102)'), { errno: -102 });
      });
      await register(guest);

      await expect(
        invokeIpc('browserSidebar.navigate', {
          sessionId: 'topic:a',
          url: 'http://127.0.0.1:18748/',
        }),
      ).resolves.toEqual({
        error:
          'Could not open http://127.0.0.1:18748/: ERR_CONNECTION_REFUSED (-102). The browser is showing its error page.',
        success: false,
      });
    });

    it('treats a superseded navigation (ERR_ABORTED) as settled', async () => {
      const guest = createWebContents(7);
      guest.loadURL = vi.fn(async () => {
        throw Object.assign(new Error('ERR_ABORTED (-3)'), { errno: -3 });
      });
      await register(guest);

      await expect(
        invokeIpc('browserSidebar.navigate', {
          sessionId: 'topic:a',
          url: 'https://example.com/redirects',
        }),
      ).resolves.toEqual({ success: true });
    });

    it('waits for a slow replacement navigation to commit after ERR_ABORTED', async () => {
      vi.useFakeTimers();
      const guest = createWebContents(7);
      guest.getURL.mockReturnValue('http://127.0.0.1:16001/');
      // A redirect rejects loadURL as the replacement starts; the replacement
      // document only commits 10s later.
      guest.isLoading.mockReturnValue(true);
      guest.loadURL = vi.fn(async () => {
        setTimeout(() => {
          guest.getURL.mockReturnValue('https://example.com/landing');
          guest.emit('did-navigate', {}, 'https://example.com/landing');
        }, 10_000);
        throw Object.assign(new Error('ERR_ABORTED (-3)'), { errno: -3 });
      });
      await register(guest);

      let settled: unknown;
      const pending = invokeIpc('browserSidebar.navigate', {
        sessionId: 'topic:a',
        url: 'https://example.com/redirects',
      }).then((result) => (settled = result));
      await vi.advanceTimersByTimeAsync(8000);
      expect(settled).toBeUndefined();

      await vi.advanceTimersByTimeAsync(2000);
      await expect(pending).resolves.toEqual({ success: true });
      expect(guest.listenerCount('did-navigate')).toBe(1);
      vi.useRealTimers();
    });

    it('waits for a redirect that starts after the requested document committed', async () => {
      vi.useFakeTimers();
      const guest = createWebContents(7);
      guest.getURL.mockReturnValue('http://127.0.0.1:16001/');
      guest.isLoading.mockReturnValue(true);
      // The requested page commits, then a script redirect aborts its load; the
      // redirect target only commits 10s later.
      guest.loadURL = vi.fn(async () => {
        guest.getURL.mockReturnValue('https://example.com/start');
        guest.emit('did-navigate', {}, 'https://example.com/start');
        setTimeout(() => {
          guest.getURL.mockReturnValue('https://example.com/landing');
          guest.emit('did-navigate', {}, 'https://example.com/landing');
        }, 10_000);
        throw Object.assign(new Error('ERR_ABORTED (-3)'), { errno: -3 });
      });
      await register(guest);

      let settled: unknown;
      const pending = invokeIpc('browserSidebar.navigate', {
        sessionId: 'topic:a',
        url: 'https://example.com/start',
      }).then((result) => (settled = result));
      await vi.advanceTimersByTimeAsync(8000);
      expect(settled).toBeUndefined();

      await vi.advanceTimersByTimeAsync(2000);
      await expect(pending).resolves.toEqual({ success: true });
      expect(guest.getURL()).toBe('https://example.com/landing');
      vi.useRealTimers();
    });

    it('does not report success when the replacement after ERR_ABORTED never commits', async () => {
      vi.useFakeTimers();
      const guest = createWebContents(7);
      guest.getURL.mockReturnValue('http://127.0.0.1:16001/');
      guest.isLoading.mockReturnValue(true);
      guest.loadURL = vi.fn(async () => {
        throw Object.assign(new Error('ERR_ABORTED (-3)'), { errno: -3 });
      });
      await register(guest);

      const pending = invokeIpc('browserSidebar.navigate', {
        sessionId: 'topic:a',
        url: 'https://example.com/redirects',
      });
      await vi.advanceTimersByTimeAsync(15_000);

      await expect(pending).resolves.toEqual({
        error:
          'https://example.com/redirects has not responded within 15s, so the browser is still showing http://127.0.0.1:16001/. The load continues in the background — check with readPage or snapshot before acting on the page, or navigate again.',
        success: false,
      });
      expect(guest.listenerCount('did-navigate')).toBe(1);
      vi.useRealTimers();
    });

    it('reports a replacement after ERR_ABORTED that stops without committing', async () => {
      vi.useFakeTimers();
      const guest = createWebContents(7);
      guest.getURL.mockReturnValue('http://127.0.0.1:16001/');
      guest.isLoading.mockReturnValue(true);
      guest.loadURL = vi.fn(async () => {
        setTimeout(() => {
          guest.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://x/', true);
          guest.emit('did-stop-loading');
        }, 1000);
        throw Object.assign(new Error('ERR_ABORTED (-3)'), { errno: -3 });
      });
      await register(guest);

      const pending = invokeIpc('browserSidebar.navigate', {
        sessionId: 'topic:a',
        url: 'https://example.com/redirects',
      });
      await vi.advanceTimersByTimeAsync(1000);

      await expect(pending).resolves.toEqual({
        error:
          'Could not open https://example.com/redirects: ERR_CONNECTION_REFUSED (-102). The browser is still showing http://127.0.0.1:16001/.',
        success: false,
      });
      // Only the page's own listeners remain.
      expect(guest.listenerCount('did-fail-load')).toBe(1);
      expect(guest.listenerCount('did-stop-loading')).toBe(1);
      vi.useRealTimers();
    });
  });

  it('keeps sessions isolated and activates the most recently registered host', async () => {
    const oldGuest = createWebContents(1);
    const newGuest = createWebContents(2);
    const otherGuest = createWebContents(3);
    const guests = new Map([
      [1, oldGuest],
      [2, newGuest],
      [3, otherGuest],
    ]);
    fromIdMock.mockImplementation((id: number) => guests.get(id));

    await invokeIpc('browserSidebar.registerWebview', {
      sessionId: 'topic:a',
      webContentsId: 1,
    });
    await invokeIpc('browserSidebar.registerWebview', {
      sessionId: 'topic:b',
      webContentsId: 3,
    });
    await invokeIpc('browserSidebar.registerWebview', {
      sessionId: 'topic:a',
      webContentsId: 2,
    });
    await invokeIpc('browserSidebar.navigate', {
      sessionId: 'topic:a',
      url: 'https://a.example',
    });
    await invokeIpc('browserSidebar.navigate', {
      sessionId: 'topic:b',
      url: 'https://b.example',
    });

    expect(oldGuest.loadURL).not.toHaveBeenCalled();
    expect(newGuest.loadURL).toHaveBeenCalledWith('https://a.example');
    expect(otherGuest.loadURL).toHaveBeenCalledWith('https://b.example');
  });
});
