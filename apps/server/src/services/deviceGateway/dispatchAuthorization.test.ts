import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findWorkspaceDeviceById: vi.fn() }));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(function () {
    return {
      findWorkspaceDeviceById: mocks.findWorkspaceDeviceById,
    };
  }),
}));

const { resolveDeviceDispatchAuthorizationFailure } = await import('./dispatchAuthorization');
const serverDB = {} as LobeChatDatabase;

describe('resolveDeviceDispatchAuthorizationFailure', () => {
  beforeEach(() => vi.clearAllMocks());

  /** @example Personal dispatch does not have a workspace registry boundary. */
  it('allows personal dispatch without a registry lookup', async () => {
    await expect(
      resolveDeviceDispatchAuthorizationFailure(serverDB, 'user-1', 'device-1'),
    ).resolves.toBeUndefined();
    expect(mocks.findWorkspaceDeviceById).not.toHaveBeenCalled();
  });

  /** @example A visible workspace registration permits the selected device dispatch. */
  it('allows workspace dispatch while its registry row remains visible', async () => {
    mocks.findWorkspaceDeviceById.mockResolvedValue({ deviceId: 'device-1' });

    await expect(
      resolveDeviceDispatchAuthorizationFailure(serverDB, 'user-1', 'device-1', 'workspace-1'),
    ).resolves.toBeUndefined();
    expect(mocks.findWorkspaceDeviceById).toHaveBeenCalledWith('device-1');
  });

  /** @example Unshare revokes a previously selected target before its next tool call. */
  it('returns structured failure after the workspace row is removed', async () => {
    // ROOT CAUSE:
    //
    // Target discovery was checked once, but a later tool call reused activeDeviceId directly.
    // Unshare could delete the registry row while a stale socket remained, allowing new work.
    // The dispatch boundary now rechecks the visible workspace row before every new call.
    mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);

    await expect(
      resolveDeviceDispatchAuthorizationFailure(serverDB, 'user-1', 'device-1', 'workspace-1'),
    ).resolves.toEqual({
      code: 'DEVICE_NOT_FOUND',
      deviceId: 'device-1',
      retryable: true,
      scope: 'workspace',
      workspaceId: 'workspace-1',
    });
  });
});
