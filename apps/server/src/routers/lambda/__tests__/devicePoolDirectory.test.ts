// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  grants: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  // NOTICE:
  // Supply an authenticated test caller without contacting the auth service.
  // The router contract under test starts after authentication.
  // Context: deviceExecutionProcedure in ../device.ts.
  // Remove if a shared authenticated router fixture replaces this setup.
  return {
    requireWorkspaceRole: () => trpc.middleware((opts) => opts.next()),
    wsCompatProcedure: trpc.procedure,
    wsProcedure: trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { serverDatabase: trpc.middleware((opts) => opts.next()) };
});
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {},
  WorkspaceDevicePrivateConflictError: class extends Error {},
}));
vi.mock('@/database/models/user', () => ({ UserModel: class {} }));
vi.mock('@/libs/trpc/utils/internalJwt', () => ({ signWorkspaceDeviceToken: vi.fn() }));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { listProjectDirectory: mocks.list },
}));
vi.mock('@/server/services/deviceGateway/poolAccess', () => ({
  DevicePoolAccessService: class {
    isEnabled = mocks.enabled;
    authorizedDevices = mocks.grants;
    createContext = async () => ({ actorUserId: 'owner', trigger: 'chat' });
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.grants.mockResolvedValue([]);
  mocks.list.mockResolvedValue([{ name: 'example.txt' }]);
});

/** @example A denied pool must prevent remote directory reads before dispatch. */
it('rejects a directory read when no pool grants device access', async () => {
  // ROOT CAUSE:
  // The upstream directory route used deviceProcedure, which bypassed pool policy.
  // Routing it through deviceExecutionProcedure rejects a missing grant before I/O.
  const caller = deviceRouter.createCaller({ userId: 'owner' });
  /** @example No grant yields FORBIDDEN instead of returning directory entries. */
  await expect(
    caller.listProjectDirectory({ deviceId: 'device', relativePath: '', root: '/project' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  /** @example Denial does not contact the device gateway. */
  expect(mocks.list).not.toHaveBeenCalled();
});

/** @example With Labs disabled, the existing personal directory path still works. */
it('retains the legacy personal read when Labs is disabled', async () => {
  mocks.enabled.mockResolvedValue(false);
  const caller = deviceRouter.createCaller({ userId: 'owner' });
  /** @example Legacy users receive the gateway directory entries. */
  await expect(
    caller.listProjectDirectory({ deviceId: 'device', relativePath: '', root: '/project' }),
  ).resolves.toEqual([{ name: 'example.txt' }]);
});
