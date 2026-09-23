import { EventEmitter } from 'node:events';

import { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { CONNECTOR_OAUTH_RESULT_CHANNEL } from '~common/connectorOAuth';

import ConnectorOAuthCtr from '../ConnectorOAuthCtr';

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), ipcMain: { handle: vi.fn() } }));
vi.mock('@/const/dir', () => ({ preloadDir: '/preload' }));
vi.mock('../RemoteServerConfigCtr', () => ({ default: class {} }));

const callback = 'https://server.example/oauth/connector/callback';
const authorizationUrl = `https://provider.example/authorize?state=expected-state&redirect_uri=${encodeURIComponent(callback)}`;
const params = { authorizationUrl, connectorId: 'connector-1' };

const makePopup = () => {
  const popup = Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn().mockResolvedValue(undefined),
    webContents: Object.assign(new EventEmitter(), {
      ipc: new EventEmitter(),
      mainFrame: { url: `${callback}?state=expected-state&code=code` },
      session: {
        setPermissionCheckHandler: vi.fn(),
        setPermissionRequestHandler: vi.fn(),
      },
      setWindowOpenHandler: vi.fn(),
    }),
  });
  popup.destroy.mockImplementation(() => {
    popup.isDestroyed.mockReturnValue(true);
    popup.emit('closed');
  });
  return popup;
};

describe('ConnectorOAuthCtr', () => {
  let popup: ReturnType<typeof makePopup>;
  let parent: EventEmitter;
  let controller: ConnectorOAuthCtr;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    popup = makePopup();
    parent = new EventEmitter();
    vi.mocked(BrowserWindow).mockImplementation(function () {
      return popup as unknown as BrowserWindow;
    });
    controller = new ConnectorOAuthCtr({
      browserManager: { getMainWindow: () => ({ browserWindow: parent }) },
      getController: () => ({ getRemoteServerUrl: async () => 'https://server.example' }),
    } as unknown as App);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const success = { connectorId: 'connector-1', success: true, type: 'lobe-connector-oauth' };
  const send = (data = success, senderFrame = popup.webContents.mainFrame) =>
    popup.webContents.ipc.emit(CONNECTOR_OAUTH_RESULT_CHANNEL, { senderFrame }, data);

  it('opens an isolated native window and completes without window.opener', async () => {
    const result = controller.authorize(params);
    await Promise.resolve();
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          partition: 'connector-oauth',
          preload: '/preload/connectorOAuth.js',
          sandbox: true,
          webviewTag: false,
        },
      }),
    );
    expect(popup.loadURL).toHaveBeenCalledWith(authorizationUrl);
    send();
    await expect(result).resolves.toBe('success');
    expect(popup.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(parent.listenerCount('closed')).toBe(0);
  });

  it('keeps waiting after an aborted load caused by navigation', async () => {
    popup.loadURL.mockRejectedValue(Object.assign(new Error('aborted'), { code: 'ERR_ABORTED' }));
    const result = controller.authorize(params);
    await Promise.resolve();
    await Promise.resolve();
    popup.webContents.emit('did-fail-load', {}, -3, '', '', true);
    expect(popup.destroy).not.toHaveBeenCalled();
    send();
    await expect(result).resolves.toBe('success');
  });

  it('rejects a different callback origin, path, state, connector or subframe', async () => {
    const result = controller.authorize(params);
    await Promise.resolve();
    for (const url of [
      'https://evil.example/oauth/connector/callback?state=expected-state',
      'https://server.example/other?state=expected-state',
      `${callback}?state=wrong-state`,
    ]) {
      popup.webContents.mainFrame.url = url;
      send();
    }
    popup.webContents.mainFrame.url = `${callback}?state=expected-state`;
    send({ ...success, connectorId: 'other' });
    send(success, { url: popup.webContents.mainFrame.url });
    expect(popup.destroy).not.toHaveBeenCalled();
    send();
    await expect(result).resolves.toBe('success');
  });

  it.each([
    'file:///etc/passwd',
    'https://evil.example/authorize?state=x&redirect_uri=https://evil.example/callback',
  ])('rejects unsafe input %s', async (url) => {
    await expect(controller.authorize({ ...params, authorizationUrl: url })).resolves.toBe(
      'failed',
    );
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it.each(['closed', 'denied', 'timeout', 'load-failure', 'parent-closed'])(
    'settles %s and cleans up',
    async (scenario) => {
      const result = controller.authorize(params);
      await Promise.resolve();
      if (scenario === 'closed') popup.emit('closed');
      if (scenario === 'parent-closed') parent.emit('closed');
      if (scenario === 'denied') send({ ...success, success: false });
      if (scenario === 'timeout') vi.advanceTimersByTime(5 * 60_000);
      if (scenario === 'load-failure')
        popup.webContents.emit('did-fail-load', {}, -105, '', '', true);
      await expect(result).resolves.toBe(
        scenario === 'closed' || scenario === 'parent-closed'
          ? 'dismissed'
          : scenario === 'timeout'
            ? 'timeout'
            : 'failed',
      );
      expect(vi.getTimerCount()).toBe(0);
      expect(parent.listenerCount('closed')).toBe(0);
    },
  );

  it('blocks nested windows and local navigation but permits provider redirects', async () => {
    const result = controller.authorize(params);
    await Promise.resolve();
    expect(popup.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    const event = { preventDefault: vi.fn() };
    popup.webContents.emit('will-navigate', event, 'app://renderer');
    popup.webContents.emit('will-redirect', event, 'file:///etc/passwd');
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    popup.webContents.emit('will-redirect', event, 'https://login.example/authorize');
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    popup.emit('closed');
    await result;
  });
});
