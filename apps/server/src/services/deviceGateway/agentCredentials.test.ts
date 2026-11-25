import type { GatewayHttpClient } from '@lobechat/device-gateway-client';
import { describe, expect, it, vi } from 'vitest';

import {
  checkAgentCredential,
  installAgentCredential,
  removeAgentCredential,
} from './agentCredentials';

const address = { deviceId: 'device-1', userId: 'user-1', workspaceId: 'ws-1' };
const secret = {
  expiresAt: '2026-07-01T00:00:00.000Z',
  token: 'sk-ant-oat01-secret',
  type: 'claude-oauth-token' as const,
};

const clientWith = (invokeRpc: ReturnType<typeof vi.fn>) => () =>
  ({ invokeRpc }) as unknown as GatewayHttpClient;

describe('agent credential relays', () => {
  it('installs on the CLI connection with exactly the contract params', async () => {
    const invokeRpc = vi.fn(async () => ({
      data: { installed: true, provider: 'claude-code' },
      success: true,
    }));

    const result = await installAgentCredential(clientWith(invokeRpc), address, {
      provider: 'claude-code',
      secret,
    });

    expect(result).toEqual({ data: { installed: true, provider: 'claude-code' }, status: 'ok' });
    expect(invokeRpc).toHaveBeenCalledWith(
      {
        deviceId: 'device-1',
        timeout: 15_000,
        userId: 'user-1',
        workspaceId: 'ws-1',
      },
      { method: 'installAgentCredential', params: { provider: 'claude-code', secret } },
    );
  });

  it('reports a client without credential support as unsupported', async () => {
    const invokeRpc = vi.fn(async () => ({
      error: 'Unknown device RPC method: removeAgentCredential',
      success: false,
    }));

    const result = await removeAgentCredential(clientWith(invokeRpc), address, {
      provider: 'codex',
    });

    expect(result.status).toBe('unsupported');
  });

  it('reports a device-side failure as failed and a thrown transport as unavailable', async () => {
    const failing = vi.fn(async () => ({
      error: 'Agent credential error: Invalid agent credential params: provider',
      success: false,
    }));
    expect(
      (await checkAgentCredential(clientWith(failing), address, { provider: 'codex' })).status,
    ).toBe('failed');

    const throwing = vi.fn(async () => {
      throw new Error('net down');
    });
    expect(
      await checkAgentCredential(clientWith(throwing), address, { provider: 'codex' }),
    ).toEqual({ message: 'net down', status: 'unavailable' });
  });

  it('reports a gateway failure without the device marker as unavailable', async () => {
    const invokeRpc = vi.fn(async () => ({ error: 'DEVICE_OFFLINE', success: false }));
    expect(
      (
        await installAgentCredential(clientWith(invokeRpc), address, {
          provider: 'claude-code',
          secret,
        })
      ).status,
    ).toBe('unavailable');
  });

  it('is unavailable without a configured gateway', async () => {
    expect(
      await checkAgentCredential(() => null, address, { provider: 'claude-code' }),
    ).toMatchObject({ status: 'unavailable' });
  });
});
