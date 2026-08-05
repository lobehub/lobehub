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

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

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
