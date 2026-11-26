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

const shared = { userId: 'u1', visibility: 'public' } as const;
const mine = { userId: 'u1', visibility: 'private' } as const;

describe('assertConnectorDeviceBindingAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a personal connector to bind one of the caller’s personal devices', async () => {
    findPersonalByDeviceId.mockResolvedValue({ deviceId: 'laptop' });

    await expect(
      assertConnectorDeviceBindingAllowed(personal, {
        connector: shared,
        metadata: { boundDeviceId: 'laptop' },
      }),
    ).resolves.toBeUndefined();
    expect(DeviceModel).toHaveBeenCalledWith(serverDB, 'u1');
    expect(findPersonalByDeviceId).toHaveBeenCalledWith('laptop');
  });

  it('refuses a personal connector a device that is not the caller’s', async () => {
    findPersonalByDeviceId.mockResolvedValue(undefined);

    await expect(
      assertConnectorDeviceBindingAllowed(personal, {
        connector: shared,
        metadata: { boundDeviceId: 'someone-else' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('allows a workspace connector to bind a public device of its workspace', async () => {
    findWorkspaceDeviceById.mockResolvedValue({ deviceId: 'ws-nas', visibility: 'public' });

    await expect(
      assertConnectorDeviceBindingAllowed(workspace, {
        connector: shared,
        metadata: { boundDeviceId: 'ws-nas' },
      }),
    ).resolves.toBeUndefined();
    expect(DeviceModel).toHaveBeenCalledWith(serverDB, 'u1', 'ws1');
  });

  // Only the member who enrolled a private device can reach it, while every
  // member's runs use a workspace connector
  it('refuses a workspace connector a private device, even the caller’s own', async () => {
    findWorkspaceDeviceById.mockResolvedValue({
      deviceId: 'my-private',
      userId: 'u1',
      visibility: 'private',
    });

    await expect(
      assertConnectorDeviceBindingAllowed(workspace, {
        connector: shared,
        metadata: { boundDeviceId: 'my-private' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a workspace connector a device outside the workspace', async () => {
    findWorkspaceDeviceById.mockResolvedValue(undefined);

    await expect(
      assertConnectorDeviceBindingAllowed(workspace, {
        connector: shared,
        metadata: { boundDeviceId: 'personal-laptop' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  describe('a private workspace connector', () => {
    // Only its creator's private agents load it, so their own device is reachable
    it('may bind its creator’s own private device', async () => {
      findWorkspaceDeviceById.mockResolvedValue({
        deviceId: 'my-private',
        userId: 'u1',
        visibility: 'private',
      });

      await expect(
        assertConnectorDeviceBindingAllowed(workspace, {
          connector: mine,
          metadata: { boundDeviceId: 'my-private' },
        }),
      ).resolves.toBeUndefined();
    });

    it('may bind a public device of the workspace', async () => {
      findWorkspaceDeviceById.mockResolvedValue({
        deviceId: 'ws-nas',
        userId: 'enroller',
        visibility: 'public',
      });

      await expect(
        assertConnectorDeviceBindingAllowed(workspace, {
          connector: mine,
          metadata: { boundDeviceId: 'ws-nas' },
        }),
      ).resolves.toBeUndefined();
    });

    // The device read only returns the caller's own private rows; one written
    // for another member's connector must still be that member's device
    it('refuses a private device of someone other than its creator', async () => {
      findWorkspaceDeviceById.mockResolvedValue({
        deviceId: 'owner-private',
        userId: 'u1',
        visibility: 'private',
      });

      await expect(
        assertConnectorDeviceBindingAllowed(workspace, {
          connector: { userId: 'teammate', visibility: 'private' },
          metadata: { boundDeviceId: 'owner-private' },
          previous: { metadata: {}, visibility: 'private' },
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('refuses a teammate’s private device, which the caller cannot read', async () => {
      findWorkspaceDeviceById.mockResolvedValue(undefined);

      await expect(
        assertConnectorDeviceBindingAllowed(workspace, {
          connector: mine,
          metadata: { boundDeviceId: 'teammate-private' },
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    // Sharing hands the kept binding to every member's runs
    it('cannot be shared while it stays bound to a private device', async () => {
      findWorkspaceDeviceById.mockResolvedValue({
        deviceId: 'my-private',
        userId: 'u1',
        visibility: 'private',
      });

      await expect(
        assertConnectorDeviceBindingAllowed(workspace, {
          connector: shared,
          metadata: undefined,
          previous: { metadata: { boundDeviceId: 'my-private' }, visibility: 'private' },
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('before sharing it'),
      });
    });

    it('can be shared when it is bound to a public device', async () => {
      findWorkspaceDeviceById.mockResolvedValue({
        deviceId: 'ws-nas',
        userId: 'enroller',
        visibility: 'public',
      });

      await expect(
        assertConnectorDeviceBindingAllowed(workspace, {
          connector: shared,
          metadata: undefined,
          previous: { metadata: { boundDeviceId: 'ws-nas' }, visibility: 'private' },
        }),
      ).resolves.toBeUndefined();
      expect(findWorkspaceDeviceById).toHaveBeenCalledWith('ws-nas');
    });

    it('can be shared once the same write unbinds it', async () => {
      await expect(
        assertConnectorDeviceBindingAllowed(workspace, {
          connector: shared,
          metadata: {},
          previous: { metadata: { boundDeviceId: 'my-private' }, visibility: 'private' },
        }),
      ).resolves.toBeUndefined();
      expect(DeviceModel).not.toHaveBeenCalled();
    });
  });

  it('skips writes without a binding, and a binding the write keeps unchanged', async () => {
    await assertConnectorDeviceBindingAllowed(workspace, {
      connector: shared,
      metadata: { description: 'x' },
    });
    await assertConnectorDeviceBindingAllowed(workspace, {
      connector: shared,
      metadata: undefined,
    });
    await assertConnectorDeviceBindingAllowed(workspace, {
      connector: shared,
      metadata: { boundDeviceId: 'unshared-since' },
      previous: { metadata: { boundDeviceId: 'unshared-since' }, visibility: 'public' },
    });
    // An edit that leaves metadata alone keeps the binding, as does making it private
    await assertConnectorDeviceBindingAllowed(workspace, {
      connector: mine,
      metadata: undefined,
      previous: { metadata: { boundDeviceId: 'unshared-since' }, visibility: 'public' },
    });

    expect(DeviceModel).not.toHaveBeenCalled();
  });

  it('refuses a malformed binding', async () => {
    await expect(
      assertConnectorDeviceBindingAllowed(personal, {
        connector: shared,
        metadata: { boundDeviceId: 42 },
      }),
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
