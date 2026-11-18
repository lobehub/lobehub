// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, devices, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DeviceModel } from '../device';

/**
 * Removing a device must not leave agents pointing at it: a stale
 * `boundDeviceId` keeps routing runs (and the device chip) to a machine the
 * account no longer has, and `lh device delete` can no longer find it to retry.
 */
const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'device-agent-bindings-user';
const otherUserId = 'device-agent-bindings-other';
const wsId = 'device-agent-bindings-ws';
const otherWsId = 'device-agent-bindings-ws-2';

const agencyConfigOf = async (agentId: string) => {
  const [row] = await serverDB
    .select({ agencyConfig: agents.agencyConfig, updatedAt: agents.updatedAt })
    .from(agents)
    .where(eq(agents.id, agentId));
  return row;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values([
    { id: wsId, name: 'WS', primaryOwnerId: userId, slug: 'device-agent-bindings-ws' },
    { id: otherWsId, name: 'WS 2', primaryOwnerId: userId, slug: 'device-agent-bindings-ws-2' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('DeviceModel.delete clears personal agent bindings', () => {
  beforeEach(async () => {
    await serverDB.insert(devices).values([
      { deviceId: 'gone', identitySource: 'machine-id', userId },
      { deviceId: 'kept', identitySource: 'machine-id', userId },
    ]);
  });

  it('drops the bound device and its working directory, keeping other devices', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    await serverDB.insert(agents).values({
      agencyConfig: {
        boundDeviceId: 'gone',
        executionTarget: 'device',
        workingDirByDevice: {
          gone: { git: { branch: 'main' }, path: '/repo' },
          kept: '/kept',
        },
      },
      id: 'agent-bound',
      updatedAt,
      userId,
    });

    await new DeviceModel(serverDB, userId).delete('gone');

    const row = await agencyConfigOf('agent-bound');
    // The device target goes with its device; the agent is back on its default.
    expect(row.agencyConfig).toEqual({ workingDirByDevice: { kept: '/kept' } });
    // A cleanup is not an edit: the agent must not jump to the top of the sidebar.
    expect(row.updatedAt).toEqual(updatedAt);
  });

  it('drops a working directory left for a device the agent is no longer bound to', async () => {
    await serverDB.insert(agents).values({
      agencyConfig: { boundDeviceId: 'kept', workingDirByDevice: { gone: '/old', kept: '/k' } },
      id: 'agent-dir-only',
      userId,
    });

    await new DeviceModel(serverDB, userId).delete('gone');

    expect((await agencyConfigOf('agent-dir-only')).agencyConfig).toEqual({
      boundDeviceId: 'kept',
      workingDirByDevice: { kept: '/k' },
    });
  });

  it('leaves agents of other users and workspace agents alone', async () => {
    await serverDB.insert(agents).values([
      { agencyConfig: { boundDeviceId: 'gone' }, id: 'agent-other-user', userId: otherUserId },
      {
        agencyConfig: { boundDeviceId: 'gone' },
        id: 'agent-workspace',
        userId,
        workspaceId: wsId,
      },
    ]);

    await new DeviceModel(serverDB, userId).delete('gone');

    expect((await agencyConfigOf('agent-other-user')).agencyConfig).toEqual({
      boundDeviceId: 'gone',
    });
    expect((await agencyConfigOf('agent-workspace')).agencyConfig).toEqual({
      boundDeviceId: 'gone',
    });
  });

  it('keeps bindings when no device row was removed', async () => {
    await serverDB.insert(agents).values({
      agencyConfig: { boundDeviceId: 'not-registered' },
      id: 'agent-unregistered',
      userId,
    });

    await expect(new DeviceModel(serverDB, userId).delete('not-registered')).resolves.toEqual([]);

    expect((await agencyConfigOf('agent-unregistered')).agencyConfig).toEqual({
      boundDeviceId: 'not-registered',
    });
  });
});

describe('DeviceModel.deleteWorkspaceDevice clears workspace agent bindings', () => {
  beforeEach(async () => {
    await serverDB.insert(devices).values([
      {
        deviceId: 'ws-gone',
        identitySource: 'machine-id',
        userId,
        visibility: 'public',
        workspaceId: wsId,
      },
      {
        deviceId: 'ws-gone',
        identitySource: 'machine-id',
        userId,
        visibility: 'public',
        workspaceId: otherWsId,
      },
    ]);
  });

  it("clears every member's agents in the workspace, private ones included", async () => {
    await serverDB.insert(agents).values([
      {
        agencyConfig: {
          boundDeviceId: 'ws-gone',
          executionTarget: 'device',
          executionTargetSelectionPolicy: 'member',
          workingDirByDevice: { 'ws-gone': '/w' },
        },
        id: 'agent-ws-public',
        userId,
        visibility: 'public',
        workspaceId: wsId,
      },
      {
        agencyConfig: { boundDeviceId: 'ws-gone' },
        id: 'agent-ws-private-other',
        userId: otherUserId,
        visibility: 'private',
        workspaceId: wsId,
      },
      {
        agencyConfig: { boundDeviceId: 'ws-gone' },
        id: 'agent-other-ws',
        userId,
        workspaceId: otherWsId,
      },
    ]);

    await new DeviceModel(serverDB, userId, wsId).deleteWorkspaceDevice('ws-gone');

    expect((await agencyConfigOf('agent-ws-public')).agencyConfig).toEqual({
      executionTargetSelectionPolicy: 'member',
      workingDirByDevice: {},
    });
    expect((await agencyConfigOf('agent-ws-private-other')).agencyConfig).toEqual({});
    // The same device id enrolled in another workspace is a different row.
    expect((await agencyConfigOf('agent-other-ws')).agencyConfig).toEqual({
      boundDeviceId: 'ws-gone',
    });
  });

  it('hands a fixed device contract back to member choice once its device is gone', async () => {
    await serverDB.insert(agents).values({
      agencyConfig: {
        boundDeviceId: 'ws-gone',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      },
      id: 'agent-ws-fixed',
      userId,
      visibility: 'public',
      workspaceId: wsId,
    });

    await new DeviceModel(serverDB, userId, wsId).deleteWorkspaceDevice('ws-gone');

    expect((await agencyConfigOf('agent-ws-fixed')).agencyConfig).toEqual({
      executionTargetSelectionPolicy: 'member',
    });
  });

  it('keeps a local target, which still means "this machine" without the binding', async () => {
    await serverDB.insert(agents).values({
      agencyConfig: { boundDeviceId: 'ws-gone', executionTarget: 'local' },
      id: 'agent-ws-local',
      userId,
      workspaceId: wsId,
    });

    await new DeviceModel(serverDB, userId, wsId).deleteWorkspaceDevice('ws-gone');

    expect((await agencyConfigOf('agent-ws-local')).agencyConfig).toEqual({
      executionTarget: 'local',
    });
  });
});
