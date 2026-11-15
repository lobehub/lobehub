import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertBoundDeviceOperable,
  assertConnectorDeviceBindingAllowed,
} from './connectorDeviceBinding';

const findWorkspaceDeviceById = vi.hoisted(() => vi.fn());
const findPersonalByDeviceId = vi.hoisted(() => vi.fn());
const DeviceModel = vi.hoisted(() =>
  vi.fn(function DeviceModel() {
    return { findPersonalByDeviceId, findWorkspaceDeviceById };
  }),
);
vi.mock('@/database/models/device', () => ({ DeviceModel }));

const serverDB = {} as never;
const personal = { serverDB, userId: 'u1' };
const workspace = { serverDB, userId: 'u1', workspaceId: 'ws1' };

describe('assertConnectorDeviceBindingAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a personal connector to bind one of the caller’s personal devices', async () => {
    findPersonalByDeviceId.mockResolvedValue({ deviceId: 'laptop' });

    await expect(
      assertConnectorDeviceBindingAllowed(personal, { boundDeviceId: 'laptop' }),
    ).resolves.toBeUndefined();
    expect(DeviceModel).toHaveBeenCalledWith(serverDB, 'u1');
    expect(findPersonalByDeviceId).toHaveBeenCalledWith('laptop');
  });

  it('refuses a personal connector a device that is not the caller’s', async () => {
    findPersonalByDeviceId.mockResolvedValue(undefined);

    await expect(
      assertConnectorDeviceBindingAllowed(personal, { boundDeviceId: 'someone-else' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('allows a workspace connector to bind a public device of its workspace', async () => {
    findWorkspaceDeviceById.mockResolvedValue({ deviceId: 'ws-nas', visibility: 'public' });

    await expect(
      assertConnectorDeviceBindingAllowed(workspace, { boundDeviceId: 'ws-nas' }),
    ).resolves.toBeUndefined();
    expect(DeviceModel).toHaveBeenCalledWith(serverDB, 'u1', 'ws1');
  });

  // Only the member who enrolled a private device can reach it, while every
  // member's runs use a workspace connector
  it('refuses a workspace connector a private device, even the caller’s own', async () => {
    findWorkspaceDeviceById.mockResolvedValue({ deviceId: 'my-private', visibility: 'private' });

    await expect(
      assertConnectorDeviceBindingAllowed(workspace, { boundDeviceId: 'my-private' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a workspace connector a device outside the workspace', async () => {
    findWorkspaceDeviceById.mockResolvedValue(undefined);

    await expect(
      assertConnectorDeviceBindingAllowed(workspace, { boundDeviceId: 'personal-laptop' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('skips writes without a binding, and a binding the write keeps unchanged', async () => {
    await assertConnectorDeviceBindingAllowed(workspace, { description: 'x' });
    await assertConnectorDeviceBindingAllowed(workspace, undefined);
    await assertConnectorDeviceBindingAllowed(
      workspace,
      { boundDeviceId: 'unshared-since' },
      { boundDeviceId: 'unshared-since' },
    );

    expect(DeviceModel).not.toHaveBeenCalled();
  });

  it('refuses a malformed binding', async () => {
    await expect(
      assertConnectorDeviceBindingAllowed(personal, { boundDeviceId: 42 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('assertBoundDeviceOperable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const publicDevice = { deviceId: 'ws-nas', userId: 'enroller', visibility: 'public' };

  it('lets a member run an MCP server on a public workspace device', async () => {
    findWorkspaceDeviceById.mockResolvedValue(publicDevice);

    await expect(
      assertBoundDeviceOperable({ ...workspace, workspaceRole: 'member' }, 'ws-nas'),
    ).resolves.toBeUndefined();
  });

  // A connection test starts the stdio command on that machine
  it('refuses a workspace viewer, even on a public device', async () => {
    findWorkspaceDeviceById.mockResolvedValue(publicDevice);

    await expect(
      assertBoundDeviceOperable({ ...workspace, workspaceRole: 'viewer' }, 'ws-nas'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("refuses another member's private device", async () => {
    findWorkspaceDeviceById.mockResolvedValue({ ...publicDevice, visibility: 'private' });

    await expect(
      assertBoundDeviceOperable({ ...workspace, workspaceRole: 'member' }, 'ws-nas'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('needs no check without a binding or for a personal binding', async () => {
    await assertBoundDeviceOperable({ ...workspace, workspaceRole: 'viewer' }, undefined);
    await assertBoundDeviceOperable(personal, 'my-laptop');

    expect(DeviceModel).not.toHaveBeenCalled();
  });
});
