import { LocalSystemApiName } from '@lobechat/builtin-tool-local-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ManagedDeviceWake from '@/server/services/deviceGateway/managedDeviceWake';

import { type ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  awaitManagedDeviceForToolCall: vi.fn(),
  executeToolCall: vi.fn(),
}));

vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: (_serverDB: unknown, ...args: unknown[]) =>
    mocks.executeToolCall(...args),
}));

vi.mock('@/server/services/deviceGateway/managedDeviceWake', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedDeviceWake>()),
  awaitManagedDeviceForToolCall: mocks.awaitManagedDeviceForToolCall,
}));

const { localSystemRuntime } = await import('../localSystem');

const context: ToolExecutionContext = {
  activeDeviceId: 'managed-a',
  activeDeviceScope: 'personal',
  serverDB: {} as any,
  toolManifestMap: {},
  userId: 'user-1',
};
const callReadFile = () => {
  const proxy = localSystemRuntime.factory(context) as Record<string, (args: any) => Promise<any>>;
  return proxy[LocalSystemApiName.readFile]({ path: '/tmp/a.txt' });
};
const offline = { content: 'offline', error: 'DEVICE_OFFLINE', success: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('localSystemRuntime — managed cloud devices', () => {
  it('returns DEVICE_WAKING when the managed device is still starting', async () => {
    mocks.executeToolCall.mockResolvedValue(offline);
    mocks.awaitManagedDeviceForToolCall.mockResolvedValue({
      content: 'starting',
      error: {
        code: 'DEVICE_WAKING',
        deviceId: 'managed-a',
        message: 'starting',
        retryAfterSeconds: 15,
      },
      success: false,
    });

    const result = await callReadFile();

    expect(mocks.awaitManagedDeviceForToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      'managed-a',
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'DEVICE_WAKING', kind: 'stop' });
    expect(mocks.executeToolCall).toHaveBeenCalledTimes(1);
  });

  it('sends the call once more when the device comes online during the wait', async () => {
    mocks.executeToolCall
      .mockResolvedValueOnce(offline)
      .mockResolvedValueOnce({ content: 'file body', success: true });
    mocks.awaitManagedDeviceForToolCall.mockResolvedValue('online');

    const result = await callReadFile();

    expect(mocks.executeToolCall).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ content: 'file body', success: true });
  });

  it('keeps a tool failure on an online device as it was', async () => {
    mocks.executeToolCall.mockResolvedValue({
      content: 'ENOENT',
      error: 'File not found',
      success: false,
    });

    const result = await callReadFile();

    expect(mocks.awaitManagedDeviceForToolCall).not.toHaveBeenCalled();
    expect(result.content).toBe('ENOENT');
  });

  it('keeps the offline failure of an ordinary device', async () => {
    mocks.executeToolCall.mockResolvedValue(offline);
    mocks.awaitManagedDeviceForToolCall.mockResolvedValue(undefined);

    const result = await callReadFile();

    expect(result.content).toBe('offline');
    expect(mocks.executeToolCall).toHaveBeenCalledTimes(1);
  });
});
