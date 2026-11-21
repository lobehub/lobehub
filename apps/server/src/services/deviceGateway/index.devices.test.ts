import type * as DeviceGatewayClientModule from '@lobechat/device-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeviceGateway } from '.';
import { resolveDeviceClientKinds } from './clientKinds';
import {
  cacheRedis,
  getRedisServiceClient,
  mockClient,
  mockEnv,
  MockGatewayHttpClient,
  resetGatewayMocks,
} from './testUtils';

vi.mock('@/server/services/redis/client', () =>
  import('./testUtils').then((m) => ({ getRedisServiceClient: m.getRedisServiceClient })),
);

vi.mock('@/envs/gateway', () => import('./testUtils').then((m) => ({ gatewayEnv: m.mockEnv })));

// Partial mock: only the HTTP client is swapped. The transport-failure
// describers are pure functions the service calls to phrase its errors, and
// stubbing them would test nothing.
vi.mock('@lobechat/device-gateway-client', async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceGatewayClientModule>()),
  GatewayHttpClient: (await import('./testUtils')).MockGatewayHttpClient,
}));

describe('DeviceGateway', () => {
  beforeEach(() => {
    resetGatewayMocks();
  });

  describe('isConfigured', () => {
    it('should return false when DEVICE_GATEWAY_URL is not set', () => {
      const proxy = new DeviceGateway();
      expect(proxy.isConfigured).toBe(false);
    });

    it('should return true when DEVICE_GATEWAY_URL is set', () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      const proxy = new DeviceGateway();
      expect(proxy.isConfigured).toBe(true);
    });
  });

  describe('queryDeviceStatus', () => {
    it('should return offline status when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceStatus('user-1');
      expect(result).toEqual({ deviceCount: 0, online: false });
    });

    it('should return status from client on success', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const expected = { deviceCount: 2, online: true };
      mockClient.queryDeviceStatus.mockResolvedValue(expected);

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual(expected);
      expect(mockClient.queryDeviceStatus).toHaveBeenCalledWith('user-1', undefined);
    });

    it('should return offline status on error', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.queryDeviceStatus.mockRejectedValue(new Error('network error'));

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
    });
  });

  describe('queryDeviceList', () => {
    it('should return empty array when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceList('user-1');
      expect(result).toEqual([]);
    });

    it('should map device-centric channels to lastSeen + online and flatten channels', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const connectedAt = Date.parse('2025-01-15T10:30:00Z');
      const iso = new Date(connectedAt).toISOString();
      mockClient.queryDeviceList.mockResolvedValue([
        {
          channels: [
            { channel: 'desktop', connectedAt, connectionId: 'conn-a' },
            { channel: 'cli', connectedAt, connectionId: 'conn-b' },
          ],
          connectedAt,
          deviceId: 'dev-1',
          hostname: 'my-laptop',
          platform: 'darwin',
        },
        {
          channels: [{ channel: 'desktop', connectedAt, connectionId: 'conn-c' }],
          connectedAt,
          deviceId: 'dev-2',
          hostname: 'my-desktop',
          platform: 'win32',
        },
      ]);

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceList('user-1');

      expect(result).toEqual([
        {
          channels: [
            { channel: 'desktop', connectedAt: iso, connectionId: 'conn-a' },
            { channel: 'cli', connectedAt: iso, connectionId: 'conn-b' },
          ],
          deviceId: 'dev-1',
          hostname: 'my-laptop',
          lastSeen: iso,
          online: true,
          platform: 'darwin',
        },
        {
          channels: [{ channel: 'desktop', connectedAt: iso, connectionId: 'conn-c' }],
          deviceId: 'dev-2',
          hostname: 'my-desktop',
          lastSeen: iso,
          online: true,
          platform: 'win32',
        },
      ]);
      expect(mockClient.queryDeviceList).toHaveBeenCalledWith('user-1', undefined);
    });

    /**
     * The gateway promises no channel order, but every consumer reads
     * `channels[0]` as the device's current connection — the settings row's
     * "Connected {time}", a ghost row's `lastSeen`/hostname/platform — while
     * `sortDevicesByActivity` ranks by the freshest channel. Leave the pool raw
     * and a multi-channel device gets ranked by one connection and labelled
     * with another, which reads as a broken sort.
     */
    it('sorts channels newest-first so channels[0] is the current connection', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const older = Date.parse('2025-01-15T10:30:00Z');
      const newest = Date.parse('2025-03-20T08:00:00Z');
      const middle = Date.parse('2025-02-01T12:00:00Z');
      mockClient.queryDeviceList.mockResolvedValue([
        {
          // Deliberately unordered, with the newest NOT first.
          channels: [
            { channel: 'cli', connectedAt: older, connectionId: 'conn-old' },
            { channel: 'desktop', connectedAt: newest, connectionId: 'conn-new' },
            { channel: 'mobile', connectedAt: middle, connectionId: 'conn-mid' },
          ],
          connectedAt: older,
          deviceId: 'dev-1',
          hostname: 'my-laptop',
          platform: 'darwin',
        },
      ]);

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceList('user-1');

      expect(result[0]?.channels?.map((c) => c.connectionId)).toEqual([
        'conn-new',
        'conn-mid',
        'conn-old',
      ]);
    });

    it('tolerates a legacy gateway response without channels', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const connectedAt = Date.parse('2025-01-15T10:30:00Z');
      mockClient.queryDeviceList.mockResolvedValue([
        { connectedAt, deviceId: 'dev-1', hostname: 'my-laptop', platform: 'darwin' },
      ]);

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceList('user-1');

      expect(result).toEqual([
        {
          channels: [],
          deviceId: 'dev-1',
          hostname: 'my-laptop',
          lastSeen: new Date(connectedAt).toISOString(),
          online: true,
          platform: 'darwin',
        },
      ]);
    });

    it('absorbs a transient failure instead of reporting an empty pool', async () => {
      // The online set decides which devices a run may reach, so one dropped
      // connection must not read as "every device is offline".
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const connectedAt = Date.parse('2025-01-15T10:30:00Z');
      mockClient.queryDeviceList
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce([
          { connectedAt, deviceId: 'dev-1', hostname: 'my-laptop', platform: 'darwin' },
        ]);

      const result = await new DeviceGateway().queryDeviceList('user-1');

      expect(mockClient.queryDeviceList).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ deviceId: 'dev-1', online: true });
    });

    it('reports the fallback out loud when the gateway stays unreachable', async () => {
      // The old bare `catch {}` made this failure invisible: a device-bound run
      // degraded to the cloud sandbox with no breadcrumb in any log.
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.queryDeviceList.mockRejectedValue(new Error('fetch failed'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(function () {});

      const result = await new DeviceGateway().queryDeviceList('user-1', 'ws-1');

      expect(result).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('queryDeviceList'),
        expect.objectContaining({ error: 'fetch failed', userId: 'user-1', workspaceId: 'ws-1' }),
      );
    });

    it('should return empty array on error', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.queryDeviceList.mockRejectedValue(new Error('fail'));

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceList('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('queryDeviceSystemInfo', () => {
    it('should return undefined when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');
      expect(result).toBeUndefined();
    });

    it('should return systemInfo on success', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const systemInfo = { cpuModel: 'Apple M1', os: 'macOS', totalMemory: 16384 };
      mockClient.getDeviceSystemInfo.mockResolvedValue({ success: true, systemInfo });

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toEqual(systemInfo);
      expect(mockClient.getDeviceSystemInfo).toHaveBeenCalledWith('user-1', 'dev-1', undefined, {
        clientKinds: ['desktop'],
      });
    });

    it('should return undefined when result is not successful', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.getDeviceSystemInfo.mockResolvedValue({ success: false });

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toBeUndefined();
    });

    it('should return undefined on error', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.getDeviceSystemInfo.mockRejectedValue(new Error('timeout'));

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toBeUndefined();
    });

    it('asks the device directly when no maxAge is given', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.getDeviceSystemInfo.mockResolvedValue({ success: true, systemInfo: {} });

      await new DeviceGateway().queryDeviceSystemInfo('user-1', 'dev-1');

      expect(getRedisServiceClient).not.toHaveBeenCalled();
      expect(cacheRedis.get).not.toHaveBeenCalled();
    });

    it('serves a recent answer through the cache when maxAge is set', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const systemInfo = { arch: 'arm64' };
      mockClient.getDeviceSystemInfo.mockResolvedValue({ success: true, systemInfo });

      const result = await new DeviceGateway().queryDeviceSystemInfo('user-1', 'dev-1', 'ws-1', {
        maxAgeMs: 180_000,
      });

      expect(result).toEqual(systemInfo);
      // The key carries user, pool and device so two principals never share an answer.
      expect(cacheRedis.get).toHaveBeenCalledWith('device_system_info:v1:user-1:ws-1:dev-1');
      expect(cacheRedis.set).toHaveBeenCalledWith(
        'device_system_info:v1:user-1:ws-1:dev-1',
        JSON.stringify(systemInfo),
        { px: 180_000 },
      );
    });
  });

  describe('queryDeviceSystemInfo client preference', () => {
    const configure = () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
    };

    it('falls back to any client when the device has no desktop app', async () => {
      configure();
      const systemInfo = { arch: 'arm64', userDataPath: '/home/u/.lobehub' };
      mockClient.getDeviceSystemInfo
        .mockResolvedValueOnce({ error: 'NO_CAPABLE_CONNECTION', success: false })
        .mockResolvedValueOnce({ success: true, systemInfo });

      const result = await new DeviceGateway().queryDeviceSystemInfo('user-1', 'dev-1', 'ws-1');

      expect(result).toEqual(systemInfo);
      expect(mockClient.getDeviceSystemInfo).toHaveBeenNthCalledWith(1, 'user-1', 'dev-1', 'ws-1', {
        clientKinds: ['desktop'],
      });
      expect(mockClient.getDeviceSystemInfo).toHaveBeenNthCalledWith(
        2,
        'user-1',
        'dev-1',
        'ws-1',
        undefined,
      );
    });

    it.each(['TIMEOUT', 'DEVICE_OFFLINE'])(
      'asks any client when the desktop read fails with %s',
      async (error) => {
        configure();
        const systemInfo = { arch: 'arm64', userDataPath: '/home/u/.lobehub' };
        mockClient.getDeviceSystemInfo
          .mockResolvedValueOnce({ error, success: false })
          .mockResolvedValueOnce({ success: true, systemInfo });

        const result = await new DeviceGateway().queryDeviceSystemInfo('user-1', 'dev-1');

        expect(result).toEqual(systemInfo);
        expect(mockClient.getDeviceSystemInfo).toHaveBeenNthCalledWith(
          2,
          'user-1',
          'dev-1',
          undefined,
          undefined,
        );
      },
    );

    it('asks any client when the desktop read throws', async () => {
      configure();
      const systemInfo = { arch: 'arm64' };
      mockClient.getDeviceSystemInfo
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce({ success: true, systemInfo });

      const result = await new DeviceGateway().queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toEqual(systemInfo);
    });

    it('returns undefined when neither read is answered', async () => {
      configure();
      mockClient.getDeviceSystemInfo.mockResolvedValue({
        error: 'DEVICE_NOT_FOUND',
        success: false,
      });

      const result = await new DeviceGateway().queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toBeUndefined();
      expect(mockClient.getDeviceSystemInfo).toHaveBeenCalledTimes(2);
    });
  });

  describe('readDeviceSystemInfo', () => {
    const configure = () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
    };

    it('reports an unconfigured gateway', async () => {
      const result = await new DeviceGateway().readDeviceSystemInfo('user-1', 'dev-1');
      expect(result).toEqual({ ok: false, reason: 'GATEWAY_NOT_CONFIGURED' });
    });

    it('returns systemInfo on success', async () => {
      configure();
      const systemInfo = { arch: 'arm64', supportedTools: ['lobe-computer-use'] };
      mockClient.getDeviceSystemInfo.mockResolvedValue({ success: true, systemInfo });

      const result = await new DeviceGateway().readDeviceSystemInfo('user-1', 'dev-1', 'ws-1');

      expect(result).toEqual({ ok: true, systemInfo });
      expect(mockClient.getDeviceSystemInfo).toHaveBeenCalledWith(
        'user-1',
        'dev-1',
        'ws-1',
        undefined,
      );
    });

    it("keeps the gateway's reason for an unanswered read", async () => {
      configure();
      mockClient.getDeviceSystemInfo.mockResolvedValue({ error: 'TIMEOUT', success: false });

      const result = await new DeviceGateway().readDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toEqual({ ok: false, reason: 'TIMEOUT' });
    });

    it('classifies a client-side timeout', async () => {
      configure();
      mockClient.getDeviceSystemInfo.mockRejectedValue(
        Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }),
      );

      const result = await new DeviceGateway().readDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toEqual({ ok: false, reason: 'DEVICE_RESPONSE_TIMEOUT' });
    });
  });

  describe('queryDeviceMetrics', () => {
    const params = { deviceId: 'dev-1', since: 1000, userId: 'user-1', workspaceId: 'ws-1' };
    const configure = () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
    };

    it('returns the gateway samples', async () => {
      configure();
      const samples = [{ observedAt: 2000 }];
      mockClient.getDeviceMetrics.mockResolvedValue(samples);

      await expect(new DeviceGateway().queryDeviceMetrics(params)).resolves.toEqual(samples);
      expect(mockClient.getDeviceMetrics).toHaveBeenCalledWith('user-1', 'dev-1', {
        since: 1000,
        workspaceId: 'ws-1',
      });
    });

    it('degrades to no samples when the gateway read fails', async () => {
      configure();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockClient.getDeviceMetrics.mockRejectedValue(
        new Error('device metrics read failed: HTTP 500'),
      );

      await expect(new DeviceGateway().queryDeviceMetrics(params)).resolves.toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('device metrics read failed'),
        expect.objectContaining({
          deviceId: 'dev-1',
          error: 'device metrics read failed: HTTP 500',
        }),
      );
      warn.mockRestore();
    });
  });

  describe('getClient (lazy initialization)', () => {
    it('should return null when URL is missing', async () => {
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
      expect(MockGatewayHttpClient).not.toHaveBeenCalled();
    });

    it('should return null when token is missing', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
      expect(MockGatewayHttpClient).not.toHaveBeenCalled();
    });

    it('should create client only once across multiple calls', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.queryDeviceStatus.mockResolvedValue({ deviceCount: 1, online: true });

      const proxy = new DeviceGateway();
      await proxy.queryDeviceStatus('user-1');
      await proxy.queryDeviceStatus('user-2');

      expect(MockGatewayHttpClient).toHaveBeenCalledTimes(1);
      expect(MockGatewayHttpClient).toHaveBeenCalledWith({
        gatewayUrl: 'https://gateway.example.com',
        resolveClientKinds: resolveDeviceClientKinds,
        serviceToken: 'token',
      });
    });
  });
});
