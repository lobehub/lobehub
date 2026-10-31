import type * as DeviceGatewayClientModule from '@lobechat/device-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeviceGateway } from '.';
import { mockClient, mockEnv, resetGatewayMocks } from './testUtils';

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

  describe('remote app update', () => {
    const configure = () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
    };
    const params = { deviceId: 'device-1', userId: 'user-1' };

    it('asks the desktop channel for the update state', async () => {
      configure();
      const state = { currentVersion: '2.1.0', stage: 'downloaded', targetVersion: '2.2.0' };
      mockClient.invokeRpc.mockResolvedValue({ data: state, success: true });

      await expect(new DeviceGateway().getAppUpdateState(params)).resolves.toEqual({
        state,
        status: 'ok',
      });
      expect(mockClient.invokeRpc).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'desktop', deviceId: 'device-1', userId: 'user-1' }),
        { method: 'getAppUpdateState' },
      );
    });

    it('returns the version the device restarts into', async () => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({ data: { targetVersion: '2.2.0' }, success: true });

      await expect(new DeviceGateway().installAppUpdate(params)).resolves.toEqual({
        status: 'ok',
        targetVersion: '2.2.0',
      });
    });

    it.each([
      'This device client does not support remote updates',
      'Unknown device RPC method: checkAppUpdate',
    ])('reports a client that cannot update remotely as unsupported (%s)', async (error) => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({ error, success: false });

      await expect(new DeviceGateway().checkAppUpdate(params)).resolves.toEqual({
        message: error,
        status: 'unsupported',
      });
    });

    it('reports an unreachable device as unavailable', async () => {
      configure();
      mockClient.invokeRpc.mockRejectedValue(new Error('timeout'));

      await expect(new DeviceGateway().getAppUpdateState(params)).resolves.toEqual({
        message: 'timeout',
        status: 'unavailable',
      });
    });

    it('reports unavailable without a configured gateway', async () => {
      await expect(new DeviceGateway().installAppUpdate(params)).resolves.toMatchObject({
        status: 'unavailable',
      });
      expect(mockClient.invokeRpc).not.toHaveBeenCalled();
    });
  });

  describe('remote CLI maintenance', () => {
    const params = { deviceId: 'device', userId: 'user', workspaceId: 'workspace' };
    const restart = { requestId: '89d177cf-52e5-4d55-b71c-13deef4ea366', update: true };

    beforeEach(() => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
    });

    it.each(['getCliUpdateState', 'checkCliUpdate', 'restartCli'] as const)(
      'targets only the CLI channel for %s',
      async (method) => {
        const state = {
          activeTasks: 0,
          currentVersion: '1.0.0',
          instanceId: 'instance',
          supported: true,
        };
        mockClient.invokeRpc.mockResolvedValue({ data: state, success: true });
        await expect(new DeviceGateway()[method]({ ...params, ...restart })).resolves.toEqual({
          state,
          status: 'ok',
        });
        expect(mockClient.invokeRpc).toHaveBeenCalledWith(
          { ...params, channel: 'cli', timeout: 15_000 },
          { method, ...(method === 'restartCli' ? { params: restart } : {}) },
        );
      },
    );

    it.each([
      'Unknown device RPC method: checkCliUpdate',
      'This device client does not support remote CLI updates',
    ])('reports unsupported old clients: %s', async (message) => {
      mockClient.invokeRpc.mockResolvedValue({ error: message, success: false });
      await expect(new DeviceGateway().checkCliUpdate(params)).resolves.toEqual({
        message,
        status: 'unsupported',
      });
    });

    it('reports offline devices as unavailable', async () => {
      mockClient.invokeRpc.mockResolvedValue({ error: 'Device offline', success: false });
      await expect(new DeviceGateway().restartCli({ ...params, ...restart })).resolves.toEqual({
        message: 'Device offline',
        status: 'unavailable',
      });
    });

    it('distinguishes an explicit maintenance refusal from an ambiguous transport failure', async () => {
      mockClient.invokeRpc.mockResolvedValue({
        error: 'CLI_MAINTENANCE_REJECTED: This device has active tasks.',
        success: false,
      });
      await expect(new DeviceGateway().restartCli({ ...params, ...restart })).resolves.toEqual({
        message: 'This device has active tasks.',
        status: 'rejected',
      });
    });

    it('reports timeout as unavailable', async () => {
      mockClient.invokeRpc.mockRejectedValue(new Error('timeout'));
      await expect(new DeviceGateway().getCliUpdateState(params)).resolves.toEqual({
        message: 'timeout',
        status: 'unavailable',
      });
    });

    it('reports an unconfigured gateway as unavailable', async () => {
      mockEnv.DEVICE_GATEWAY_URL = undefined;
      await expect(new DeviceGateway().getCliUpdateState(params)).resolves.toMatchObject({
        status: 'unavailable',
      });
      expect(mockClient.invokeRpc).not.toHaveBeenCalled();
    });
  });
});
