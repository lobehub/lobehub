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
      // A page with a request that never completes: loadURL never settles.
      guest.loadURL = vi.fn(() => new Promise(() => {}));
      await register(guest);

      const pending = invokeIpc('browserSidebar.navigate', {
        sessionId: 'topic:a',
        url: 'http://127.0.0.1:9876/',
      });
      await vi.advanceTimersByTimeAsync(15_000);

      await expect(pending).resolves.toEqual({ success: true });
      vi.useRealTimers();
    });

    it('reports a navigation that left the requested page unopened', async () => {
      const guest = createWebContents(7);
      await guest.loadURL('http://127.0.0.1:16001/');
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
