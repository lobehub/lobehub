import { EventEmitter } from 'node:events';

import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { IpcHandler } from '@/utils/ipc/base';

import BrowserSidebarCtr from '../BrowserSidebarCtr';

const {
  appOnMock,
  clipboardWriteImageMock,
  importChromeLoginDataMock,
  ipcHandlers,
  ipcMainHandleMock,
  sessionFromPartitionMock,
  shellOpenExternalMock,
  webContentsFromIdMock,
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
    importChromeLoginDataMock: vi.fn(),
    ipcHandlers: handlers,
    ipcMainHandleMock: handle,
    sessionFromPartitionMock: vi.fn(),
    shellOpenExternalMock: vi.fn().mockResolvedValue(undefined),
    webContentsFromIdMock: vi.fn(),
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

vi.mock('@/modules/browser/importChromeLoginData', () => ({
  importChromeLoginData: importChromeLoginDataMock,
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
  webContents: {
    fromId: webContentsFromIdMock,
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
  guest.capturePage = vi.fn(async () => 'image') as unknown as WebContents['capturePage'];
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

  const emitWillAttach = (owner: WebContents, params: Record<string, unknown>) => {
    const webPreferences = {};
    const event = { preventDefault: vi.fn() };
    owner.emit('will-attach-webview', event, webPreferences, params);
    return { event, webPreferences };
  };

  const setupOwner = () => {
    controller.beforeAppReady();
    const webContentsCreatedHandler = appOnMock.mock.calls.find(
      ([eventName]) => eventName === 'web-contents-created',
    )?.[1];
    const owner = createOwnerWebContents();
    webContentsCreatedHandler({}, owner);
    return owner;
  };

  const attachGuest = async (guest: WebContents, sessionId = 'session-1') => {
    // Guest must live in the hardened browser partition to be claimable.
    (guest as unknown as { session: unknown }).session = mockSession;
    webContentsFromIdMock.mockReturnValue(guest);
    return invokeIpc('browserSidebar.attach', { sessionId, webContentsId: guest.id });
  };

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

  it('should harden webviews recognized by the browser partition attribute', () => {
    const owner = setupOwner();

    const params = {
      partition: 'persist:lobe-browser-app',
      src: 'example.com',
    };
    const { webPreferences } = emitWillAttach(owner, params);

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
  });

  it('should ignore webviews without the browser partition', () => {
    const owner = setupOwner();

    const params = { partition: 'persist:other', src: 'https://example.com' };
    const { webPreferences } = emitWillAttach(owner, params);

    expect(webPreferences).toEqual({});
    expect(sessionFromPartitionMock).not.toHaveBeenCalled();
  });

  it('should bind sessions through the attach IPC and broadcast state', async () => {
    setupOwner();
    const guest = createGuestWebContents();

    await expect(attachGuest(guest)).resolves.toEqual({ success: true });

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

  it('should reject attaching webContents outside the browser partition', async () => {
    setupOwner();
    const guest = createGuestWebContents();
    (guest as unknown as { session: unknown }).session = { notOurs: true };
    webContentsFromIdMock.mockReturnValue(guest);

    await expect(
      invokeIpc('browserSidebar.attach', { sessionId: 'session-1', webContentsId: guest.id }),
    ).resolves.toMatchObject({ success: false });
    expect(guest.setWindowOpenHandler).not.toHaveBeenCalled();
  });

  it('should keep window.open navigations inside the sidebar page', async () => {
    setupOwner();
    const guest = createGuestWebContents();
    await attachGuest(guest);

    const windowOpenHandler = vi.mocked(guest.setWindowOpenHandler).mock.calls[0][0];
    const result = windowOpenHandler({ url: 'https://lobehub.com' } as never);

    expect(result).toEqual({ action: 'deny' });
    expect(guest.loadURL).toHaveBeenCalledWith('https://lobehub.com');
    expect(shellOpenExternalMock).not.toHaveBeenCalled();
  });

  it('should navigate and capture the attached page through IPC methods', async () => {
    setupOwner();
    const guest = createGuestWebContents();
    await attachGuest(guest);

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

  it('should import Chrome login information into the browser session', async () => {
    importChromeLoginDataMock.mockResolvedValue(12);

    await expect(invokeIpc('browserSidebar.importChromeLoginData')).resolves.toEqual({
      importedCount: 12,
      success: true,
    });
    expect(importChromeLoginDataMock).toHaveBeenCalledWith(mockSession);
  });

  it('should return a recoverable error when Chrome login import fails', async () => {
    importChromeLoginDataMock.mockRejectedValue(new Error('Chrome profile was not found'));

    await expect(invokeIpc('browserSidebar.importChromeLoginData')).resolves.toEqual({
      error: 'Chrome profile was not found',
      importedCount: 0,
      success: false,
    });
  });
});
