import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeToolCall: vi.fn(),
  resolveAuthorizationFailure: vi.fn(),
}));

vi.mock('./dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: mocks.resolveAuthorizationFailure,
}));
vi.mock('./index', () => ({ deviceGateway: { executeToolCall: mocks.executeToolCall } }));

const { executeAuthorizedDeviceToolCall } = await import('./authorizedToolCall');
const serverDB = {} as LobeChatDatabase;
const params = { deviceId: 'device-1', userId: 'user-1', workspaceId: 'workspace-1' };
const toolCall = { apiName: 'readFile', arguments: '{}', identifier: 'local-system' };

describe('executeAuthorizedDeviceToolCall', () => {
  beforeEach(() => vi.clearAllMocks());

  /** @example A stale workspace socket receives no new work after Unshare. */
  it('fails before Gateway dispatch when registry authority was removed', async () => {
    mocks.resolveAuthorizationFailure.mockResolvedValue({
      code: 'DEVICE_NOT_FOUND',
      deviceId: 'device-1',
      retryable: true,
      scope: 'workspace',
      workspaceId: 'workspace-1',
    });

    const result = await executeAuthorizedDeviceToolCall(serverDB, params, toolCall);

    expect(result).toMatchObject({
      error: 'DEVICE_NOT_FOUND',
      errorData: { code: 'DEVICE_NOT_FOUND', retryable: true },
      success: false,
    });
    expect(mocks.executeToolCall).not.toHaveBeenCalled();
  });
});
