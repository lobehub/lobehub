// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  checkAppUpdate: vi.fn(),
  checkCliUpdate: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  getAppUpdateState: vi.fn(),
  getCliUpdateState: vi.fn(),
  installAppUpdate: vi.fn(),
  restartCli: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findWorkspaceDeviceById = mocks.findWorkspaceDeviceById;
  },
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    checkAppUpdate: mocks.checkAppUpdate,
    checkCliUpdate: mocks.checkCliUpdate,
    getAppUpdateState: mocks.getAppUpdateState,
    getCliUpdateState: mocks.getCliUpdateState,
    installAppUpdate: mocks.installAppUpdate,
    restartCli: mocks.restartCli,
  },
}));

const workspaceCaller = (userId: string, workspaceRole: 'member' | 'owner') =>
  deviceRouter.createCaller({ userId, workspaceId: 'workspace', workspaceRole } as never);

describe('remote app update', () => {
  const cliInput = {
    deviceId: 'device',
    requestId: '89d177cf-52e5-4d55-b71c-13deef4ea366',
    update: true,
  };

  it.each(['getCliUpdateState', 'checkCliUpdate', 'restartCli'] as const)(
    'rejects unauthorized workspace CLI request %s',
    async (procedure) => {
      const input = procedure === 'restartCli' ? cliInput : { deviceId: 'device' };
      await expect(
        workspaceCaller('other', 'member')[procedure](input as typeof cliInput),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks[procedure]).not.toHaveBeenCalled();
    },
  );

  it.each(['getCliUpdateState', 'checkCliUpdate', 'restartCli'] as const)(
    'retains visibility checks for %s',
    async (procedure) => {
      mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);
      await expect(workspaceCaller('owner', 'owner')[procedure](cliInput)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mocks[procedure]).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['enroller', 'member'],
    ['owner', 'owner'],
  ] as const)('allows authorized %s CLI maintenance', async (userId, role) => {
    const state = {
      activeTasks: 0,
      currentVersion: '1.0.0',
      instanceId: 'instance',
      supported: true,
    };
    for (const procedure of ['getCliUpdateState', 'checkCliUpdate', 'restartCli'] as const) {
      mocks[procedure].mockResolvedValue({ state, status: 'ok' });
      const input = procedure === 'restartCli' ? cliInput : { deviceId: 'device' };
      await expect(
        workspaceCaller(userId, role)[procedure](input as typeof cliInput),
      ).resolves.toEqual({ state, status: 'ok' });
    }
    expect(mocks.restartCli).toHaveBeenCalledWith({
      ...cliInput,
      userId,
      workspaceId: 'workspace',
    });
  });

  it.each([
    { ...cliInput, requestId: 'not-a-uuid' },
    { ...cliInput, update: 'true' },
    ...['package', 'version', 'command'].map((key) => ({ ...cliInput, [key]: 'untrusted' })),
  ])('rejects invalid or arbitrary restart inputs: %j', async (input) => {
    await expect(
      workspaceCaller('owner', 'owner').restartCli(input as typeof cliInput),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.restartCli).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findWorkspaceDeviceById.mockResolvedValue({ deviceId: 'device', userId: 'enroller' });
    mocks.installAppUpdate.mockResolvedValue({ status: 'ok', targetVersion: '2.2.0' });
  });

  it('lets the enrolling member restart a workspace device into its update', async () => {
    await expect(
      workspaceCaller('enroller', 'member').installAppUpdate({ deviceId: 'device' }),
    ).resolves.toEqual({ status: 'ok', targetVersion: '2.2.0' });
    expect(mocks.installAppUpdate).toHaveBeenCalledWith({
      deviceId: 'device',
      userId: 'enroller',
      workspaceId: 'workspace',
    });
  });

  it('lets a workspace owner update a device another member enrolled', async () => {
    await expect(
      workspaceCaller('owner', 'owner').installAppUpdate({ deviceId: 'device' }),
    ).resolves.toMatchObject({ status: 'ok' });
  });

  it.each(['getAppUpdateState', 'checkAppUpdate', 'installAppUpdate'] as const)(
    "rejects %s from a member on someone else's workspace device",
    async (procedure) => {
      const caller = workspaceCaller('member', 'member');
      await expect(caller[procedure]({ deviceId: 'device' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mocks[procedure]).not.toHaveBeenCalled();
    },
  );
});
