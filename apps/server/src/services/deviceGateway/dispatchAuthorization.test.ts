import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizedDevices: vi.fn(),
  isEnabled: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  loadContext: vi.fn(),
  createContext: vi.fn(),
}));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(function () {
    return { findWorkspaceDeviceById: mocks.findWorkspaceDeviceById };
  }),
}));
vi.mock('./poolAccess', () => ({
  DevicePoolAccessService: vi.fn().mockImplementation(function () {
    return mocks;
  }),
}));

const { resolveDeviceDispatchAuthorizationFailure } = await import('./dispatchAuthorization');
const serverDB = {} as LobeChatDatabase;

describe('resolveDeviceDispatchAuthorizationFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnabled.mockResolvedValue(true);
    mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);
    mocks.authorizedDevices.mockResolvedValue([]);
    mocks.loadContext.mockResolvedValue({ agentId: 'agent-1', blocked: false, trigger: 'chat' });
  });

  /** @example Personal dispatch also requires a registered policy and operation identity. */
  it('denies personal dispatch without durable provenance', async () => {
    await expect(
      resolveDeviceDispatchAuthorizationFailure(serverDB, 'user-1', 'device-1'),
    ).resolves.toMatchObject({ code: 'DEVICE_NOT_FOUND', scope: 'personal' });
    expect(mocks.authorizedDevices).not.toHaveBeenCalled();
  });

  /** @example A visible workspace registration permits the selected device dispatch. */
  it('allows workspace dispatch while its registry row remains visible', async () => {
    mocks.authorizedDevices.mockResolvedValue([{ device: { deviceId: 'device-1' } }]);

    await expect(
      resolveDeviceDispatchAuthorizationFailure(
        serverDB,
        'user-1',
        'device-1',
        'workspace-1',
        'operation-1',
      ),
    ).resolves.toBeUndefined();
    expect(mocks.loadContext).toHaveBeenCalledWith('operation-1');
  });

  /** @example Unshare revokes a previously selected target before its next tool call. */
  it('returns structured failure after the workspace row is removed', async () => {
    // ROOT CAUSE:
    //
    // Target discovery was checked once, but a later tool call reused activeDeviceId directly.
    // Unshare could delete the registry row while a stale socket remained, allowing new work.
    // The dispatch boundary now rechecks the visible workspace row before every new call.
    mocks.authorizedDevices.mockResolvedValue([]);

    await expect(
      resolveDeviceDispatchAuthorizationFailure(
        serverDB,
        'user-1',
        'device-1',
        'workspace-1',
        'operation-1',
      ),
    ).resolves.toEqual({
      code: 'DEVICE_NOT_FOUND',
      deviceId: 'device-1',
      retryable: true,
      scope: 'workspace',
      workspaceId: 'workspace-1',
    });
  });
});

/** @example Personal dispatch retains the existing no-operation behavior when Labs is off. */
it('uses existing personal dispatch while disabled', async () => {
  mocks.isEnabled.mockResolvedValue(false);
  mocks.authorizedDevices.mockClear();
  expect(
    await resolveDeviceDispatchAuthorizationFailure(serverDB, 'user-1', 'device-1'),
  ).toBeUndefined();
  expect(mocks.authorizedDevices).not.toHaveBeenCalled();
});
/** @example Workspace visibility still gates dispatch when the pool experiment is off. */
it('uses workspace registry authorization while disabled', async () => {
  mocks.isEnabled.mockResolvedValue(false);
  mocks.findWorkspaceDeviceById.mockResolvedValue({ deviceId: 'device-1' });
  expect(
    await resolveDeviceDispatchAuthorizationFailure(serverDB, 'user-1', 'device-1', 'ws'),
  ).toBeUndefined();
  mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);
  expect(
    await resolveDeviceDispatchAuthorizationFailure(serverDB, 'user-1', 'device-1', 'ws'),
  ).toMatchObject({ code: 'DEVICE_NOT_FOUND' });
});
