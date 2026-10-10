import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import GatewayConnectionService from '../gatewayConnectionSrv';

/**
 * Minimal stand-in for the real gateway client: records the options it was
 * constructed with (notably the token it will authenticate with) and lets the
 * test drive the events the service listens to.
 */
const { FakeGatewayClient } = vi.hoisted(() => {
  class FakeGatewayClient {
    static instances: any[] = [];

    options: any;
    token: string;
    handlers = new Map<string, (...args: any[]) => any>();

    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    reconnect = vi.fn(async () => {});
    updateToken = vi.fn((token: string) => {
      this.token = token;
    });
    on = vi.fn((event: string, handler: (...args: any[]) => any) => {
      this.handlers.set(event, handler);
      return this;
    });

    constructor(options: any) {
      this.options = options;
      this.token = options.token;
      FakeGatewayClient.instances.push(this);
    }

    emitToService(event: string, ...args: any[]) {
      return this.handlers.get(event)?.(...args);
    }
  }

  return { FakeGatewayClient };
});

vi.mock('@lobechat/device-gateway-client', () => ({ GatewayClient: FakeGatewayClient }));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/mock/path/${name}`),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
  powerSaveBlocker: { isStarted: vi.fn(() => false), start: vi.fn(() => 1), stop: vi.fn() },
}));

const createService = () => {
  const store: Record<string, unknown> = {};
  return new GatewayConnectionService({
    browserManager: { broadcastToAllWindows: vi.fn() },
    storeManager: {
      get: vi.fn((key: string, fallback?: unknown) => (key in store ? store[key] : fallback)),
      set: vi.fn((key: string, value: unknown) => {
        store[key] = value;
      }),
    },
  } as unknown as App);
};

describe('GatewayConnectionService auth recovery', () => {
  let service: GatewayConnectionService;
  let accessToken: string;

  beforeEach(() => {
    FakeGatewayClient.instances.length = 0;
    accessToken = 'expired-token';
    service = createService();
    service.setTokenProvider(async () => accessToken);
  });

  it('refreshes the token and reconnects after auth_failed', async () => {
    service.setTokenRefresher(async () => {
      accessToken = 'fresh-token';
      return { success: true };
    });

    await service.connect();
    expect(FakeGatewayClient.instances).toHaveLength(1);
    expect(FakeGatewayClient.instances[0].options.token).toBe('expired-token');

    FakeGatewayClient.instances[0].emitToService(
      'auth_failed',
      '"exp" claim timestamp check failed',
    );

    await vi.waitFor(() => expect(FakeGatewayClient.instances).toHaveLength(2));
    // The replacement socket carries the refreshed token, never the rejected one.
    expect(FakeGatewayClient.instances[1].options.token).toBe('fresh-token');
  });

  it('settles on disconnected without looping when the refresh fails', async () => {
    const refresher = vi.fn(async () => ({ error: 'invalid_grant', success: false }));
    service.setTokenRefresher(refresher);

    await service.connect();

    await FakeGatewayClient.instances[0].emitToService('auth_failed', 'exp');
    await vi.waitFor(() => expect(refresher).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(service.getStatus()).toBe('disconnected'));

    // No replacement socket, and a repeated auth_failed inside the cooldown adds none.
    expect(FakeGatewayClient.instances).toHaveLength(1);
    await FakeGatewayClient.instances[0].emitToService('auth_failed', 'exp');
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(FakeGatewayClient.instances).toHaveLength(1);
  });

  it('pushes a refreshed token into the live connection', async () => {
    await service.connect();

    service.syncAccessToken('fresh-token');

    expect(FakeGatewayClient.instances[0].updateToken).toHaveBeenCalledWith('fresh-token');
    expect(FakeGatewayClient.instances[0].token).toBe('fresh-token');
  });

  it('re-mints a workspace share token when the share is rejected', async () => {
    const share = new FakeGatewayClient({ token: 'stale-share-token' });
    FakeGatewayClient.instances.length = 0;
    (service as any).workspaceClients.set('ws-1', share);
    service.setWorkspaceTokenProvider(async () => 'fresh-share-token');
    (service as any).setupClientEvents(share, { workspaceId: 'ws-1' });

    share.emitToService('auth_failed', 'exp');

    await vi.waitFor(() => expect(share.updateToken).toHaveBeenCalledWith('fresh-share-token'));
    expect(share.reconnect).toHaveBeenCalled();
  });
});
