import type { GatewayClient } from '@lobechat/device-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import GatewayConnectionService from '../gatewayConnectionSrv';

const { getShellInfoMock } = vi.hoisted(() => ({ getShellInfoMock: vi.fn() }));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/mock/path/${name}`),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn() },
}));

vi.mock('@lobechat/local-file-shell/shell', () => ({ getShellInfo: getShellInfoMock }));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const createClient = () =>
  ({ sendSystemInfoResponse: vi.fn() }) as unknown as GatewayClient & {
    sendSystemInfoResponse: ReturnType<typeof vi.fn>;
  };

describe('GatewayConnectionService system_info_request', () => {
  let service: GatewayConnectionService;

  beforeEach(() => {
    getShellInfoMock.mockReset();
    service = new GatewayConnectionService({} as App);
  });

  it('answers with the collected system info', async () => {
    getShellInfoMock.mockResolvedValue({ displayName: 'zsh' });
    const client = createClient();

    await (service as any).handleSystemInfoRequest(client, { requestId: 'req-1' });

    expect(client.sendSystemInfoResponse).toHaveBeenCalledWith({
      requestId: 'req-1',
      result: {
        success: true,
        systemInfo: expect.objectContaining({
          defaultShell: 'zsh',
          homePath: '/mock/path/home',
          picturesPath: '/mock/path/pictures',
        }),
      },
    });
  });

  it('omits an optional folder Electron cannot resolve and still answers successfully', async () => {
    getShellInfoMock.mockResolvedValue({ displayName: 'pwsh' });
    const { app } = await import('electron');
    const getPath = vi.mocked(app.getPath);
    const original = getPath.getMockImplementation();
    getPath.mockImplementation((name: string) => {
      if (name === 'pictures') throw new Error("Failed to get 'pictures' path");
      return `/mock/path/${name}`;
    });
    const client = createClient();

    try {
      await (service as any).handleSystemInfoRequest(client, { requestId: 'req-3' });
    } finally {
      getPath.mockImplementation(original!);
    }

    const [response] = client.sendSystemInfoResponse.mock.calls[0];
    expect(response.requestId).toBe('req-3');
    expect(response.result.success).toBe(true);
    expect(response.result.systemInfo.picturesPath).toBeUndefined();
    expect(response.result.systemInfo.homePath).toBe('/mock/path/home');
  });

  it('still answers with a failure when collecting system info rejects', async () => {
    getShellInfoMock.mockRejectedValue(new Error('shell probe failed'));
    const client = createClient();

    await expect(
      (service as any).handleSystemInfoRequest(client, { requestId: 'req-2' }),
    ).resolves.toBeUndefined();

    expect(client.sendSystemInfoResponse).toHaveBeenCalledWith({
      requestId: 'req-2',
      result: { success: false },
    });
  });
});

describe('GatewayConnectionService power save blocker', () => {
  let service: GatewayConnectionService;
  let store: Record<string, unknown>;

  beforeEach(async () => {
    const { powerSaveBlocker } = await import('electron');
    vi.mocked(powerSaveBlocker.start).mockReset().mockReturnValue(7);
    vi.mocked(powerSaveBlocker.stop).mockReset();

    store = {};
    const app = {
      browserManager: { broadcastToAllWindows: vi.fn() },
      storeManager: {
        get: vi.fn((key: string, fallback?: unknown) => (key in store ? store[key] : fallback)),
        set: vi.fn((key: string, value: unknown) => {
          store[key] = value;
        }),
      },
    } as unknown as App;
    service = new GatewayConnectionService(app);
  });

  const setStatus = (status: string) => (service as any).setStatus(status);

  it('keeps the blocker through a transient reconnect', async () => {
    const { powerSaveBlocker } = await import('electron');

    setStatus('connected');
    setStatus('reconnecting');
    setStatus('connecting');
    setStatus('authenticating');
    setStatus('connected');

    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1);
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension');
    expect(powerSaveBlocker.stop).not.toHaveBeenCalled();
  });

  it('releases the blocker once the connection settles on disconnected', async () => {
    const { powerSaveBlocker } = await import('electron');

    setStatus('connected');
    setStatus('disconnected');

    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(7);
  });

  it('never holds the blocker when keep-awake is turned off', async () => {
    const { powerSaveBlocker } = await import('electron');
    store.gatewayKeepAwake = false;

    setStatus('connecting');
    setStatus('connected');

    expect(powerSaveBlocker.start).not.toHaveBeenCalled();
  });

  it('applies a keep-awake toggle to the live connection immediately', async () => {
    const { powerSaveBlocker } = await import('electron');
    setStatus('connected');

    service.setKeepAwake(false);
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(7);
    expect(service.getKeepAwake()).toBe(false);

    service.setKeepAwake(true);
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(2);
  });

  it('does not start the blocker from a toggle while disconnected', async () => {
    const { powerSaveBlocker } = await import('electron');

    service.setKeepAwake(true);

    expect(powerSaveBlocker.start).not.toHaveBeenCalled();
  });
});

describe('GatewayConnectionService status broadcast', () => {
  let service: GatewayConnectionService;
  let broadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcast = vi.fn();
    const app = {
      browserManager: { broadcastToAllWindows: broadcast },
      storeManager: { get: vi.fn((_key: string, fallback?: unknown) => fallback), set: vi.fn() },
    } as unknown as App;
    service = new GatewayConnectionService(app);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setStatus = (status: string) => (service as any).setStatus(status);
  const broadcastStatuses = () => broadcast.mock.calls.map(([, payload]) => payload.status);

  it('hides a reconnect that recovers within the grace period', () => {
    setStatus('connecting');
    setStatus('authenticating');
    setStatus('connected');
    broadcast.mockClear();

    setStatus('reconnecting');
    setStatus('connecting');
    setStatus('authenticating');
    vi.advanceTimersByTime(3000);
    setStatus('connected');
    vi.advanceTimersByTime(10_000);

    expect(broadcast).not.toHaveBeenCalled();
    expect(service.getDisplayedStatus()).toBe('connected');
    expect(service.getStatus()).toBe('connected');
  });

  it('surfaces a reconnect that outlasts the grace period', () => {
    setStatus('connected');
    broadcast.mockClear();

    setStatus('reconnecting');
    setStatus('connecting');
    expect(service.getDisplayedStatus()).toBe('connected');

    vi.advanceTimersByTime(5000);
    expect(broadcastStatuses()).toEqual(['connecting']);

    setStatus('authenticating');
    setStatus('connected');
    expect(broadcastStatuses()).toEqual(['connecting', 'authenticating', 'connected']);
  });

  it('shows an explicit disconnect immediately', () => {
    setStatus('connected');
    broadcast.mockClear();

    setStatus('disconnected');

    expect(broadcastStatuses()).toEqual(['disconnected']);
  });
});
