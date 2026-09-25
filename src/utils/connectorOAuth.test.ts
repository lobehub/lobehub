import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openConnectorOAuthPopup, waitForConnectorOAuth } from './connectorOAuth';

const platform = vi.hoisted(() => ({ isDesktop: false }));
const authorize = vi.hoisted(() => vi.fn());
vi.mock('@lobechat/const', () => platform);
vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ connectorOAuth: { authorize } }),
}));

const authorizationUrl =
  'https://provider.example/authorize?redirect_uri=https%3A%2F%2Fserver.example%2Foauth%2Fconnector%2Fcallback';

describe('connector OAuth popup', () => {
  let popup: Window;

  beforeEach(() => {
    vi.useFakeTimers();
    authorize.mockReset();
    platform.isDesktop = false;
    popup = { close: vi.fn(), closed: false, location: { href: '' } } as unknown as Window;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const send = (source: Window, origin: string, data: Record<string, unknown>) => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  };

  it('keeps the synchronous blank popup on web', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    expect(openConnectorOAuthPopup()).toBe(popup);
    expect(open).toHaveBeenCalledWith(
      'about:blank',
      'lobe-connector-oauth',
      'width=600,height=720',
    );
  });

  it('uses native authorization on desktop without opening a renderer popup', async () => {
    platform.isDesktop = true;
    const open = vi.spyOn(window, 'open');
    authorize.mockResolvedValue('success');
    const placeholder = openConnectorOAuthPopup();
    expect(placeholder).toBeUndefined();
    await expect(
      waitForConnectorOAuth(placeholder, 'connector-1', authorizationUrl),
    ).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledWith({ authorizationUrl, connectorId: 'connector-1' });
  });

  it.each(['dismissed', 'failed', 'timeout'])(
    'reports native %s without a success result',
    async (reason) => {
      platform.isDesktop = true;
      authorize.mockResolvedValue(reason);
      await expect(
        waitForConnectorOAuth(undefined, 'connector-1', authorizationUrl),
      ).rejects.toMatchObject({ reason });
    },
  );

  it('accepts the remote callback rather than the desktop opener origin and cleans up', async () => {
    const result = waitForConnectorOAuth(popup, 'connector-1', authorizationUrl);
    expect(popup.location.href).toBe(authorizationUrl);
    send(popup, 'https://server.example', {
      connectorId: 'connector-1',
      success: true,
      type: 'lobe-connector-oauth',
    });
    await expect(result).resolves.toBeUndefined();
    expect(popup.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports navigation failure and cleans up without accepting a later callback', async () => {
    Object.defineProperty(popup.location, 'href', {
      set: () => {
        throw new Error('Navigation blocked');
      },
    });

    await expect(
      waitForConnectorOAuth(popup, 'connector-1', authorizationUrl),
    ).rejects.toMatchObject({ reason: 'failed' });
    expect(popup.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    send(popup, 'https://server.example', {
      connectorId: 'connector-1',
      success: true,
      type: 'lobe-connector-oauth',
    });
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it('ignores other origins, windows, connectors and malformed success messages', async () => {
    const settled = vi.fn();
    const result = waitForConnectorOAuth(popup, 'connector-1', authorizationUrl).then(settled);
    const success = { connectorId: 'connector-1', success: true, type: 'lobe-connector-oauth' };
    send(popup, 'https://provider.example', success);
    send(window, 'https://server.example', success);
    send(popup, 'https://server.example', { ...success, connectorId: 'connector-2' });
    send(popup, 'https://server.example', { ...success, connectorId: undefined });
    send(popup, 'https://server.example', { ...success, success: 'true' });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(popup.close).not.toHaveBeenCalled();

    send(popup, 'https://server.example', success);
    await result;
    expect(settled).toHaveBeenCalledOnce();
  });

  it('handles provider denial without a connector ID', async () => {
    const result = waitForConnectorOAuth(popup, 'connector-1', authorizationUrl);
    send(popup, 'https://server.example', {
      error: 'access_denied',
      success: false,
      type: 'lobe-connector-oauth',
    });
    await expect(result).rejects.toMatchObject({ reason: 'failed' });
    expect(popup.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])('settles when closed (already closed=%s)', async (alreadyClosed) => {
    Object.defineProperty(popup, 'closed', { configurable: true, value: alreadyClosed });
    const result = waitForConnectorOAuth(popup, 'connector-1', authorizationUrl);
    Object.defineProperty(popup, 'closed', { value: true });
    vi.advanceTimersByTime(800);
    await expect(result).rejects.toMatchObject({ reason: 'dismissed' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a callback that never arrives and removes the message listener', async () => {
    const result = waitForConnectorOAuth(popup, 'connector-1', authorizationUrl);
    vi.advanceTimersByTime(5 * 60_000);
    await expect(result).rejects.toMatchObject({ reason: 'timeout' });
    expect(popup.close).toHaveBeenCalledOnce();
    send(popup, 'https://server.example', {
      connectorId: 'connector-1',
      success: true,
      type: 'lobe-connector-oauth',
    });
    expect(popup.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
