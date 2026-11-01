// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  browseDirectory: vi.fn(),
  createDirectory: vi.fn(),
  createTerminalSession: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
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
    browseDirectory: mocks.browseDirectory,
    createDirectory: mocks.createDirectory,
    createTerminalSession: mocks.createTerminalSession,
  },
}));

type Role = 'member' | 'owner' | 'viewer';

const workspaceCaller = (userId: string, workspaceRole: Role) =>
  deviceRouter.createCaller({ userId, workspaceId: 'workspace', workspaceRole } as never);

const withDevice = (visibility: 'private' | 'public') =>
  mocks.findWorkspaceDeviceById.mockResolvedValue({
    deviceId: 'device',
    userId: 'enroller',
    visibility,
  });

const operate = {
  browseDirectory: (userId: string, role: Role) =>
    workspaceCaller(userId, role).browseDirectory({ deviceId: 'device', path: '/home' }),
  createDirectory: (userId: string, role: Role) =>
    workspaceCaller(userId, role).createDirectory({
      deviceId: 'device',
      name: 'new-project',
      parentPath: '/home',
    }),
  createTerminalSession: (userId: string, role: Role) =>
    workspaceCaller(userId, role).createTerminalSession({ cols: 80, deviceId: 'device', rows: 24 }),
};

describe('operating a workspace device', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.browseDirectory.mockResolvedValue({ entries: [] });
    mocks.createDirectory.mockResolvedValue({ path: '/home/new-project', success: true });
    mocks.createTerminalSession.mockResolvedValue({ sessionId: 'session' });
  });

  it.each(Object.keys(operate) as (keyof typeof operate)[])(
    'lets any member %s on a public device',
    async (procedure) => {
      withDevice('public');
      await expect(operate[procedure]('member', 'member')).resolves.toBeTruthy();
      expect(mocks[procedure]).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'device', userId: 'member', workspaceId: 'workspace' }),
      );
    },
  );

  it.each(Object.keys(operate) as (keyof typeof operate)[])(
    "rejects %s from a member on someone else's private device",
    async (procedure) => {
      withDevice('private');
      await expect(operate[procedure]('member', 'member')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mocks[procedure]).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(operate) as (keyof typeof operate)[])(
    'rejects %s from a read-only viewer even on a public device',
    async (procedure) => {
      withDevice('public');
      await expect(operate[procedure]('viewer', 'viewer')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringContaining('Workspace viewers cannot'),
      });
      expect(mocks[procedure]).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['enroller', 'member'],
    ['owner', 'owner'],
  ] as const)('lets the %s browse a private device', async (userId, role) => {
    withDevice('private');
    await expect(operate.browseDirectory(userId, role)).resolves.toEqual({ entries: [] });
  });

  it('keeps hiding devices the caller cannot see', async () => {
    mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);
    await expect(operate.browseDirectory('member', 'member')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mocks.browseDirectory).not.toHaveBeenCalled();
  });
});

describe('creating a folder from the remote picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withDevice('public');
  });

  it('forwards the parent folder and trimmed name to the gateway', async () => {
    mocks.createDirectory.mockResolvedValue({ path: '/home/new-project', success: true });

    await expect(
      workspaceCaller('member', 'member').createDirectory({
        deviceId: 'device',
        name: '  new-project ',
        parentPath: '/home',
      }),
    ).resolves.toEqual({ path: '/home/new-project', success: true });
    expect(mocks.createDirectory).toHaveBeenCalledWith({
      deviceId: 'device',
      name: 'new-project',
      parentPath: '/home',
      userId: 'member',
      workspaceId: 'workspace',
    });
  });

  it.each(['..', 'a/b', 'a\\b'])(
    'rejects the folder name %s before reaching the device',
    async (name) => {
      await expect(
        workspaceCaller('member', 'member').createDirectory({
          deviceId: 'device',
          name,
          parentPath: '/home',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mocks.createDirectory).not.toHaveBeenCalled();
    },
  );

  it.each(['CON', 'a:b', 'folder.', 'folder '])(
    'rejects Windows name %j with BAD_REQUEST',
    async (name) => {
      await expect(
        workspaceCaller('member', 'member').createDirectory({
          deviceId: 'device',
          name,
          parentPath: 'C:\\Users\\me',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mocks.createDirectory).not.toHaveBeenCalled();
    },
  );

  it('reports a taken name as CONFLICT', async () => {
    mocks.createDirectory.mockResolvedValue({
      error: 'An item already exists at /home/new-project.',
      path: '/home/new-project',
      success: false,
    });

    await expect(
      workspaceCaller('member', 'member').createDirectory({
        deviceId: 'device',
        name: 'new-project',
        parentPath: '/home',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reports other device failures as BAD_REQUEST with the device message', async () => {
    mocks.createDirectory.mockResolvedValue({
      error: 'Permission denied to create /home/new-project.',
      path: '/home/new-project',
      success: false,
    });

    await expect(
      workspaceCaller('member', 'member').createDirectory({
        deviceId: 'device',
        name: 'new-project',
        parentPath: '/home',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Permission denied to create /home/new-project.',
    });
  });

  it.each([
    ['Unknown device RPC method: createLocalDirectory', 'PRECONDITION_FAILED'],
    ['Device offline', 'BAD_GATEWAY'],
  ])('relays the gateway failure %j as %s', async (message, code) => {
    mocks.createDirectory.mockRejectedValue(new Error(message));

    await expect(
      workspaceCaller('member', 'member').createDirectory({
        deviceId: 'device',
        name: 'new-project',
        parentPath: '/home',
      }),
    ).rejects.toMatchObject({ code, message });
  });
});
