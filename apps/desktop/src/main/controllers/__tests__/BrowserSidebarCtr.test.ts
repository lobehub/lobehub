import { EventEmitter } from 'node:events';

import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { IpcHandler } from '@/utils/ipc/base';

import BrowserSidebarCtr from '../BrowserSidebarCtr';

const {
  appOnMock,
  clipboardWriteImageMock,
  ipcHandlers,
  ipcMainHandleMock,
  sessionFromPartitionMock,
  shellOpenExternalMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const handle = vi.fn(
    (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  );

  return {
    appOnMock: vi.fn(),
    clipboardWriteImageMock: vi.fn(),
    ipcHandlers: handlers,
    ipcMainHandleMock: handle,
    sessionFromPartitionMock: vi.fn(),
    shellOpenExternalMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('electron', () => ({
  app: {
    on: appOnMock,
  },
  clipboard: {
    writeImage: clipboardWriteImageMock,
  },
  ipcMain: {
    handle: ipcMainHandleMock,
  },
  session: {
    fromPartition: sessionFromPartitionMock,
  },
  shell: {
    openExternal: shellOpenExternalMock,
  },
}));

const createOwnerWebContents = (id = 1): WebContents => {
  const owner = new EventEmitter() as EventEmitter & { id: number };
  owner.id = id;
  return owner as unknown as WebContents;
};

const createGuestWebContents = (overrides?: Partial<WebContents>): WebContents => {
  const guest = new EventEmitter() as EventEmitter & Partial<WebContents> & { id: number };
  guest.id = 2;
  guest.canGoBack = vi.fn(() => false);
  guest.canGoForward = vi.fn(() => false);
  guest.capturePage = vi.fn(async () => 'image');
  guest.getTitle = vi.fn(() => 'Example');
  guest.getURL = vi.fn(() => 'https://example.com');
  guest.isDestroyed = vi.fn(() => false);
  guest.isLoading = vi.fn(() => false);
  guest.loadURL = vi.fn(async () => undefined);
  guest.reload = vi.fn();
  guest.setWindowOpenHandler = vi.fn();
  guest.stop = vi.fn();
  Object.assign(guest, overrides);
  return guest as unknown as WebContents;
};

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
    webRequest: {
      onBeforeRequest: vi.fn(),
    },
  };
  const mockApp = {
    browserManager: {
      broadcastToAllWindows,
    },
  } as unknown as App;

  let controller: BrowserSidebarCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcHandlers.clear();
    ipcMainHandleMock.mockClear();
    (
      IpcHandler.getInstance() as unknown as { registeredChannels?: Set<string> }
    ).registeredChannels?.clear();
    sessionFromPartitionMock.mockReturnValue(mockSession);
    controller = new BrowserSidebarCtr(mockApp);
  });

  it('should secure and attach browser sidebar webviews', () => {
    controller.beforeAppReady();
    const webContentsCreatedHandler = appOnMock.mock.calls.find(
      ([eventName]) => eventName === 'web-contents-created',
    )?.[1];
    const owner = createOwnerWebContents();

    webContentsCreatedHandler({}, owner);

    const webPreferences = {};
    const params = {
      'data-lobe-browser-session-id': 'session-1',
      'src': 'example.com',
    };
    owner.emit('will-attach-webview', { preventDefault: vi.fn() }, webPreferences, params);

    expect(params).toMatchObject({
      partition: 'persist:lobe-browser-app',
      src: 'https://example.com',
    });
    expect(webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:lobe-browser-app',
      sandbox: true,
    });
    expect(sessionFromPartitionMock).toHaveBeenCalledWith('persist:lobe-browser-app');
    expect(mockSession.setPermissionRequestHandler).toHaveBeenCalled();
    expect(mockSession.setPermissionCheckHandler).toHaveBeenCalled();
    expect(mockSession.webRequest.onBeforeRequest).toHaveBeenCalled();

    const guest = createGuestWebContents();
    owner.emit('did-attach-webview', {}, guest);

    expect(guest.setWindowOpenHandler).toHaveBeenCalled();
    expect(broadcastToAllWindows).toHaveBeenCalledWith(
      'browserSidebarStateChanged',
      expect.objectContaining({
        attached: true,
        sessionId: 'session-1',
        title: 'Example',
        url: 'https://example.com',
      }),
    );
  });

  it('should keep window.open navigations inside the sidebar page', () => {
    controller.beforeAppReady();
    const webContentsCreatedHandler = appOnMock.mock.calls.find(
      ([eventName]) => eventName === 'web-contents-created',
    )?.[1];
    const owner = createOwnerWebContents();
    const guest = createGuestWebContents();

    webContentsCreatedHandler({}, owner);
    owner.emit(
      'will-attach-webview',
      { preventDefault: vi.fn() },
      {},
      {
        'data-lobe-browser-session-id': 'session-1',
        'src': 'https://example.com',
      },
    );
    owner.emit('did-attach-webview', {}, guest);

    const windowOpenHandler = vi.mocked(guest.setWindowOpenHandler).mock.calls[0][0];
    const result = windowOpenHandler({ url: 'https://lobehub.com' } as never);

    expect(result).toEqual({ action: 'deny' });
    expect(guest.loadURL).toHaveBeenCalledWith('https://lobehub.com');
    expect(shellOpenExternalMock).not.toHaveBeenCalled();
  });

  it('should navigate and capture the attached page through IPC methods', async () => {
    controller.beforeAppReady();
    const webContentsCreatedHandler = appOnMock.mock.calls.find(
      ([eventName]) => eventName === 'web-contents-created',
    )?.[1];
    const owner = createOwnerWebContents();
    const guest = createGuestWebContents();

    webContentsCreatedHandler({}, owner);
    owner.emit(
      'will-attach-webview',
      { preventDefault: vi.fn() },
      {},
      {
        'data-lobe-browser-session-id': 'session-1',
        'src': 'https://example.com',
      },
    );
    owner.emit('did-attach-webview', {}, guest);

    await expect(
      invokeIpc('browserSidebar.navigate', { sessionId: 'session-1', url: 'lobehub.com' }),
    ).resolves.toEqual({ success: true });
    expect(guest.loadURL).toHaveBeenCalledWith('https://lobehub.com');

    await expect(
      invokeIpc('browserSidebar.navigate', { sessionId: 'session-1', url: 'localhost:3000' }),
    ).resolves.toEqual({ success: true });
    expect(guest.loadURL).toHaveBeenCalledWith('http://localhost:3000');

    await expect(
      invokeIpc('browserSidebar.captureScreenshotToClipboard', { sessionId: 'session-1' }),
    ).resolves.toEqual({ success: true });
    expect(guest.capturePage).toHaveBeenCalled();
    expect(clipboardWriteImageMock).toHaveBeenCalledWith('image');
  });
});
