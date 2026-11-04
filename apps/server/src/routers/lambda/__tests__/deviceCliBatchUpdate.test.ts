// @vitest-environment node
import { DEVICE_CLI_BATCH_MAX_TARGETS } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  checkCliUpdate: vi.fn(),
  queryDeviceList: vi.fn(),
  queryWorkspaceDevices: vi.fn(),
  restartCli: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    queryWorkspaceDevices = mocks.queryWorkspaceDevices;
  },
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    checkCliUpdate: mocks.checkCliUpdate,
    queryDeviceList: mocks.queryDeviceList,
    restartCli: mocks.restartCli,
  },
}));

const REQUEST_ID = '89d177cf-52e5-4d55-b71c-13deef4ea366';

const caller = (userId: string, workspaceRole?: 'member' | 'owner' | 'viewer') =>
  deviceRouter.createCaller({
    userId,
    workspaceId: workspaceRole ? 'workspace' : undefined,
    workspaceRole,
  } as never);

const row = (deviceId: string, patch: Record<string, unknown> = {}) => ({
  deviceId,
  metadata: { cliVersion: '0.0.70' },
  userId: 'enroller',
  visibility: 'public',
  ...patch,
});

const live = (deviceId: string, channel = 'cli') => ({
  channels: [{ channel, connectedAt: '2026-11-04T00:00:00.000Z', connectionId: deviceId }],
  deviceId,
  hostname: deviceId,
  lastSeen: '2026-11-04T00:00:00.000Z',
  online: true,
  platform: 'linux',
});

const ready = {
  state: {
    activeTasks: 0,
    currentVersion: '0.0.70',
    instanceId: 'instance',
    latestVersion: '0.0.75',
    supported: true,
  },
  status: 'ok',
};

describe('batch CLI update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryWorkspaceDevices.mockResolvedValue([
      row('shared-a'),
      row('shared-b'),
      row('desktop-only', { metadata: { appVersion: '2.2.0' } }),
      row('mine', { userId: 'member', visibility: 'private' }),
    ]);
    mocks.queryDeviceList.mockResolvedValue([
      live('shared-a'),
      live('desktop-only', 'desktop'),
      live('mine'),
      // A gateway-only connection has no registry row and must stay unreachable.
      live('ghost'),
    ]);
    mocks.checkCliUpdate.mockResolvedValue(ready);
    mocks.restartCli.mockResolvedValue(ready);
  });

  describe('checkCliUpdates', () => {
    it('plans the CLI devices of the requested tab only', async () => {
      const entries = await caller('member', 'member').checkCliUpdates({ visibility: 'public' });
      expect(entries.map((e) => [e.deviceId, e.outcome])).toEqual([
        ['shared-a', 'ready'],
        ['shared-b', 'offline'],
      ]);
      expect(mocks.checkCliUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.checkCliUpdate).toHaveBeenCalledWith({
        deviceId: 'shared-a',
        userId: 'member',
        workspaceId: 'workspace',
      });
      expect(mocks.restartCli).not.toHaveBeenCalled();
    });

    it("plans the caller's own private devices on the private tab", async () => {
      const entries = await caller('member', 'member').checkCliUpdates({ visibility: 'private' });
      expect(entries.map((e) => e.deviceId)).toEqual(['mine']);
    });

    it('leaves out devices the caller may not operate', async () => {
      // Another member's private row the model surfaced (e.g. to an owner view)
      // still fails the single-device operate gate.
      mocks.queryWorkspaceDevices.mockResolvedValue([
        row('theirs', { userId: 'someone-else', visibility: 'private' }),
      ]);
      mocks.queryDeviceList.mockResolvedValue([live('theirs')]);
      await expect(
        caller('member', 'member').checkCliUpdates({ visibility: 'private' }),
      ).resolves.toEqual([]);
      expect(mocks.checkCliUpdate).not.toHaveBeenCalled();
    });

    it('gives a viewer nothing to update', async () => {
      await expect(
        caller('viewer', 'viewer').checkCliUpdates({ visibility: 'public' }),
      ).resolves.toEqual([]);
      expect(mocks.checkCliUpdate).not.toHaveBeenCalled();
    });

    it('requires a workspace', async () => {
      await expect(
        caller('member').checkCliUpdates({ visibility: 'public' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('updateClis', () => {
    it('restarts each target into the update with its own request id', async () => {
      const entries = await caller('member', 'member').updateClis({
        targets: [{ deviceId: 'shared-a', requestId: REQUEST_ID }],
      });
      expect(entries).toEqual([
        expect.objectContaining({ deviceId: 'shared-a', outcome: 'requested' }),
      ]);
      expect(mocks.restartCli).toHaveBeenCalledWith({
        deviceId: 'shared-a',
        requestId: REQUEST_ID,
        update: true,
        userId: 'member',
        workspaceId: 'workspace',
      });
    });

    it.each([
      ['ghost', 'member'],
      ['shared-a', 'viewer'],
      ['unknown', 'owner'],
    ] as const)('fails %s for a %s without reaching the device', async (deviceId, role) => {
      const entries = await caller(role, role).updateClis({
        targets: [{ deviceId, requestId: REQUEST_ID }],
      });
      expect(entries).toEqual([expect.objectContaining({ deviceId, outcome: 'failed' })]);
      expect(mocks.checkCliUpdate).not.toHaveBeenCalled();
      expect(mocks.restartCli).not.toHaveBeenCalled();
    });

    it('returns entries in target order', async () => {
      const entries = await caller('member', 'member').updateClis({
        targets: [
          { deviceId: 'unknown', requestId: REQUEST_ID },
          { deviceId: 'shared-b', requestId: '0f8fad5b-d9cb-469f-a165-70867728950e' },
          { deviceId: 'shared-a', requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
        ],
      });
      expect(entries.map((e) => [e.deviceId, e.outcome])).toEqual([
        ['unknown', 'failed'],
        ['shared-b', 'offline'],
        ['shared-a', 'requested'],
      ]);
    });

    it.each([
      { targets: [] },
      {
        targets: Array.from({ length: DEVICE_CLI_BATCH_MAX_TARGETS + 1 }, (_, i) => ({
          deviceId: `device-${i}`,
          requestId: REQUEST_ID,
        })),
      },
      { targets: [{ deviceId: 'shared-a', requestId: 'not-a-uuid' }] },
      {
        targets: [
          { deviceId: 'shared-a', requestId: REQUEST_ID },
          { deviceId: 'shared-a', requestId: '0f8fad5b-d9cb-469f-a165-70867728950e' },
        ],
      },
      { targets: [{ deviceId: 'shared-a', requestId: REQUEST_ID, version: '0.0.1' }] },
    ])('rejects invalid input %j', async (input) => {
      await expect(caller('member', 'member').updateClis(input as never)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(mocks.restartCli).not.toHaveBeenCalled();
    });
  });
});
