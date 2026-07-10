// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, devices, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-device-binding-user';
const wsId = 'agent-device-binding-ws';
const personalDeviceId = 'personal-device-001';
const workspaceDeviceId = 'workspace-device-001';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: wsId, name: 'WS', slug: 'ws', primaryOwnerId: userId }]);
  await serverDB.insert(devices).values([
    { userId, deviceId: personalDeviceId, identitySource: 'machine-id' },
    { userId, workspaceId: wsId, deviceId: workspaceDeviceId, identitySource: 'machine-id' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentModel workspace device binding', () => {
  describe('create', () => {
    it('allows a personal agent to bind any device', async () => {
      const personalModel = new AgentModel(serverDB, userId);
      const agent = await personalModel.create({
        title: 'Personal agent',
        agencyConfig: { boundDeviceId: personalDeviceId },
      });
      expect(agent.agencyConfig?.boundDeviceId).toBe(personalDeviceId);
    });

    it('allows a workspace agent to bind a workspace device', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      const agent = await wsModel.create({
        title: 'WS agent',
        agencyConfig: { boundDeviceId: workspaceDeviceId },
      });
      expect(agent.agencyConfig?.boundDeviceId).toBe(workspaceDeviceId);
    });

    it('rejects a workspace agent bound to a personal device', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      await expect(
        wsModel.create({
          title: 'WS agent',
          agencyConfig: { boundDeviceId: personalDeviceId },
        }),
      ).rejects.toThrow(/Workspace agent can only bind devices/);
    });

    it('rejects a workspace agent with a personal-device key in workingDirByDevice', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      await expect(
        wsModel.create({
          title: 'WS agent',
          agencyConfig: {
            workingDirByDevice: { [personalDeviceId]: '/tmp' },
          },
        }),
      ).rejects.toThrow(/Workspace agent can only bind devices/);
    });
  });

  describe('updateConfig', () => {
    it('allows clearing boundDeviceId on a workspace agent', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      const agent = await wsModel.create({
        title: 'WS agent',
        agencyConfig: { boundDeviceId: workspaceDeviceId },
      });
      await expect(
        wsModel.updateConfig(agent.id, { agencyConfig: { boundDeviceId: undefined } }),
      ).resolves.toBeDefined();
    });

    it('allows switching a workspace agent to another workspace device', async () => {
      const otherWorkspaceDeviceId = 'workspace-device-002';
      await serverDB.insert(devices).values({
        userId,
        workspaceId: wsId,
        deviceId: otherWorkspaceDeviceId,
        identitySource: 'machine-id',
      });

      const wsModel = new AgentModel(serverDB, userId, wsId);
      const agent = await wsModel.create({
        title: 'WS agent',
        agencyConfig: { boundDeviceId: workspaceDeviceId },
      });
      await wsModel.updateConfig(agent.id, {
        agencyConfig: { boundDeviceId: otherWorkspaceDeviceId },
      });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(result?.agencyConfig?.boundDeviceId).toBe(otherWorkspaceDeviceId);
    });

    it('rejects setting a personal device on a workspace agent', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      const agent = await wsModel.create({
        title: 'WS agent',
        agencyConfig: { boundDeviceId: workspaceDeviceId },
      });
      await expect(
        wsModel.updateConfig(agent.id, {
          agencyConfig: { boundDeviceId: personalDeviceId },
        }),
      ).rejects.toThrow(/Workspace agent can only bind devices/);
    });

    it('allows clearing a workingDirByDevice entry on a workspace agent (undefined value)', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      const agent = await wsModel.create({
        title: 'WS agent',
        agencyConfig: {
          boundDeviceId: workspaceDeviceId,
          workingDirByDevice: { [workspaceDeviceId]: '/work' },
        },
      });
      await expect(
        wsModel.updateConfig(agent.id, {
          agencyConfig: {
            workingDirByDevice: { [personalDeviceId]: undefined as unknown as string },
          },
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('transferAgent', () => {
    it('strips a personal-device binding when moving an agent into a workspace', async () => {
      const personalModel = new AgentModel(serverDB, userId);
      const agent = await personalModel.create({
        title: 'Personal agent',
        agencyConfig: {
          boundDeviceId: personalDeviceId,
          workingDirByDevice: { [personalDeviceId]: '/work' },
        },
      });

      await personalModel.transferAgent(agent.id, wsId, userId);

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(result?.workspaceId).toBe(wsId);
      expect(result?.agencyConfig?.boundDeviceId).toBeUndefined();
      expect(result?.agencyConfig?.workingDirByDevice).toBeUndefined();
    });

    it('preserves a workspace-device binding when the target workspace owns the device', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      const agent = await wsModel.create({
        title: 'WS agent',
        agencyConfig: {
          boundDeviceId: workspaceDeviceId,
          workingDirByDevice: { [workspaceDeviceId]: '/work' },
        },
      });

      await wsModel.transferAgent(agent.id, wsId, userId);

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(result?.agencyConfig?.boundDeviceId).toBe(workspaceDeviceId);
      expect(result?.agencyConfig?.workingDirByDevice?.[workspaceDeviceId]).toBe('/work');
    });

    it('keeps the binding intact when moving back to personal scope', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      const agent = await wsModel.create({
        title: 'WS agent',
        agencyConfig: { boundDeviceId: workspaceDeviceId },
      });

      await wsModel.transferAgent(agent.id, null, userId);

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(result?.workspaceId).toBeNull();
      expect(result?.agencyConfig?.boundDeviceId).toBe(workspaceDeviceId);
    });
  });
});
