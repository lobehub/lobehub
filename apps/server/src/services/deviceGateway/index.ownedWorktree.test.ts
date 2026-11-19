/**
 * The owned-worktree RPCs answer with an `outcome`, and every way the device
 * cannot be asked (no gateway, offline, a client too old for the method)
 * folds to `unreachable` — the caller keeps those cleanups pending.
 */
import type * as DeviceGatewayClientModule from '@lobechat/device-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeviceGateway } from '.';
import { configureGateway, mockClient, resetGatewayMocks } from './testUtils';

vi.mock('@/server/services/redis/client', () =>
  import('./testUtils').then((m) => ({ getRedisServiceClient: m.getRedisServiceClient })),
);

vi.mock('@/envs/gateway', () => import('./testUtils').then((m) => ({ gatewayEnv: m.mockEnv })));

vi.mock('@lobechat/device-gateway-client', async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceGatewayClientModule>()),
  GatewayHttpClient: (await import('./testUtils')).MockGatewayHttpClient,
}));

const base = { deviceId: 'device-1', userId: 'user-1', workspaceId: 'ws-1' };
const paths = { sourcePath: '/code/repo', worktreePath: '/home/.lobehub/worktrees/r/x' };

describe('DeviceGateway owned-worktree RPCs', () => {
  beforeEach(() => {
    resetGatewayMocks();
  });

  it('relays cleanupOwnedWorktree with only the named params', async () => {
    configureGateway();
    mockClient.invokeRpc.mockResolvedValue({
      data: { branch: 'lobehub/x', outcome: 'removed' },
      success: true,
    });

    await expect(
      new DeviceGateway().cleanupOwnedWorktree({
        ...base,
        ...paths,
        discard: true,
        ownerToken: 'receipt-0123456789abcdef',
      }),
    ).resolves.toEqual({ branch: 'lobehub/x', outcome: 'removed' });
    expect(mockClient.invokeRpc).toHaveBeenCalledWith(
      { deviceId: 'device-1', timeout: 100_000, userId: 'user-1', workspaceId: 'ws-1' },
      {
        method: 'cleanupOwnedWorktree',
        params: { discard: true, ownerToken: 'receipt-0123456789abcdef', ...paths },
      },
    );
  });

  it('relays restoreOwnedWorktree', async () => {
    configureGateway();
    mockClient.invokeRpc.mockResolvedValue({ data: { outcome: 'restored' }, success: true });

    await expect(
      new DeviceGateway().restoreOwnedWorktree({ ...base, ...paths, branch: 'lobehub/x' }),
    ).resolves.toEqual({ outcome: 'restored' });
    expect(mockClient.invokeRpc).toHaveBeenCalledWith(
      { deviceId: 'device-1', timeout: 45_000, userId: 'user-1', workspaceId: 'ws-1' },
      { method: 'restoreOwnedWorktree', params: { branch: 'lobehub/x', ...paths } },
    );
  });

  it('is unreachable without a configured gateway', async () => {
    await expect(
      new DeviceGateway().cleanupOwnedWorktree({ ...base, ...paths }),
    ).resolves.toMatchObject({ outcome: 'unreachable' });
    expect(mockClient.invokeRpc).not.toHaveBeenCalled();
  });

  it('is unreachable when the device is offline', async () => {
    configureGateway();
    mockClient.invokeRpc.mockRejectedValue(new Error('Device is offline'));
    await expect(new DeviceGateway().cleanupOwnedWorktree({ ...base, ...paths })).resolves.toEqual({
      error: 'Device is offline',
      outcome: 'unreachable',
    });
  });

  it('flags a device client that predates the RPC as outdated', async () => {
    configureGateway();
    mockClient.invokeRpc.mockResolvedValue({
      error: 'Unknown device RPC method: cleanupOwnedWorktree',
      success: false,
    });
    await expect(
      new DeviceGateway().cleanupOwnedWorktree({ ...base, ...paths }),
    ).resolves.toMatchObject({ outcome: 'unreachable', outdated: true });

    mockClient.invokeRpc.mockRejectedValue(
      new Error('Unknown device RPC method: restoreOwnedWorktree'),
    );
    await expect(
      new DeviceGateway().restoreOwnedWorktree({ ...base, ...paths, branch: 'b' }),
    ).resolves.toMatchObject({ outcome: 'unreachable', outdated: true });
  });
});
