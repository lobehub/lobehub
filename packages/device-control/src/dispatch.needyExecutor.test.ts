import { NEEDY_EXECUTOR_ERROR_PREFIX } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  DEVICE_RPC_METHODS,
  executeDeviceRpc,
  NEEDY_EXECUTOR_UNSUPPORTED_MESSAGE,
} from './dispatch';
import { deviceRpcClients } from './rpcClients';
import type { DeviceControlDeps } from './types';

const CREDENTIAL = 'needy-runner.secret-value';
const attachParams = {
  address: { host: 'needy-daemon.example.com', port: 7400 },
  attachmentId: 'session-1',
  credential: CREDENTIAL,
  runnerName: 'ext-0123456789ab-mac',
  ttlSeconds: 3600,
  version: '0.0.22',
};

const makeDeps = (overrides: Partial<DeviceControlDeps> = {}): DeviceControlDeps => ({
  getLocalFilePreview: vi.fn(),
  getProjectFileIndex: vi.fn(),
  searchProjectFiles: vi.fn(),
  ...overrides,
});

const METHODS = ['attachNeedyExecutor', 'detachNeedyExecutor'];

describe('needy executor RPCs', () => {
  it.each(METHODS)('%s is a device RPC method only the CLI serves', (method) => {
    expect(DEVICE_RPC_METHODS).toContain(method);
    expect(deviceRpcClients(method)).toEqual(['cli']);
  });

  it.each(METHODS)('%s is refused by a client without a needy supervisor', async (method) => {
    await expect(executeDeviceRpc(method, attachParams, makeDeps())).rejects.toThrow(
      NEEDY_EXECUTOR_UNSUPPORTED_MESSAGE,
    );
  });

  it('passes the raw params to the handler', async () => {
    const attachNeedyExecutor = vi.fn(async () => ({
      attachmentId: 'session-1',
      expiresAt: '2026-11-27T01:00:00.000Z',
      reused: false,
      runnerName: 'ext-0123456789ab-mac',
      version: '0.0.22',
    }));

    await executeDeviceRpc('attachNeedyExecutor', attachParams, makeDeps({ attachNeedyExecutor }));

    expect(attachNeedyExecutor).toHaveBeenCalledWith(attachParams);
  });

  it('prefixes a handler failure and never carries the credential back', async () => {
    const attachNeedyExecutor = vi.fn(async () => {
      throw new Error(`runner refused ${CREDENTIAL}`);
    });

    const error = await executeDeviceRpc(
      'attachNeedyExecutor',
      attachParams,
      makeDeps({ attachNeedyExecutor }),
    ).catch((error_: Error) => error_);

    expect((error as Error).message).toBe(
      `${NEEDY_EXECUTOR_ERROR_PREFIX} runner refused [redacted]`,
    );
  });
});
