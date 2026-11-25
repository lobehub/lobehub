import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_CREDENTIAL_UNSUPPORTED_MESSAGE,
  DEVICE_RPC_METHODS,
  executeDeviceRpc,
} from './dispatch';
import type { DeviceControlDeps } from './types';

const TOKEN = 'sk-ant-oat01-secret-token-value';
const installParams = {
  provider: 'claude-code',
  secret: { expiresAt: '2026-07-01T00:00:00.000Z', token: TOKEN, type: 'claude-oauth-token' },
};

const makeDeps = (overrides: Partial<DeviceControlDeps> = {}): DeviceControlDeps => ({
  getLocalFilePreview: vi.fn(),
  getProjectFileIndex: vi.fn(),
  searchProjectFiles: vi.fn(),
  ...overrides,
});

const METHODS = ['installAgentCredential', 'removeAgentCredential', 'checkAgentCredential'];

describe('agent credential RPCs', () => {
  it.each(METHODS)('%s is a device RPC method', (method) => {
    expect(DEVICE_RPC_METHODS).toContain(method);
  });

  it.each(METHODS)('%s is refused by a client that does not apply credentials', async (method) => {
    await expect(executeDeviceRpc(method, installParams, makeDeps())).rejects.toThrow(
      AGENT_CREDENTIAL_UNSUPPORTED_MESSAGE,
    );
  });

  it('hands the raw params to the host handler', async () => {
    const installAgentCredential = vi.fn(async () => ({
      installed: true as const,
      provider: 'claude-code' as const,
    }));

    await expect(
      executeDeviceRpc(
        'installAgentCredential',
        installParams,
        makeDeps({ installAgentCredential }),
      ),
    ).resolves.toEqual({ installed: true, provider: 'claude-code' });
    expect(installAgentCredential).toHaveBeenCalledWith(installParams);
  });

  it('strips the secret from a failing handler before it becomes the RPC error', async () => {
    const installAgentCredential = vi.fn(async () => {
      throw new Error(`EACCES: cannot write ${TOKEN}`);
    });

    const error = await executeDeviceRpc(
      'installAgentCredential',
      installParams,
      makeDeps({ installAgentCredential }),
    ).catch((e: Error) => e);

    expect((error as Error).message).toContain('EACCES');
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
