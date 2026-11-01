// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, devices, type NewAgent, users, workspaces } from '../../schemas';
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
    {
      userId,
      workspaceId: wsId,
      deviceId: workspaceDeviceId,
      identitySource: 'machine-id',
      visibility: 'public',
    },
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

    it('allows a fixed public workspace device target', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      const agent = await wsModel.create({
        title: 'Fixed WS agent',
        agencyConfig: {
          boundDeviceId: workspaceDeviceId,
          executionTargetSelectionPolicy: 'fixed',
          executionTarget: 'device',
        },
      });

      expect(agent.agencyConfig?.executionTargetSelectionPolicy).toBe('fixed');
    });

    it.each(['auto', 'none', 'sandbox'] as const)(
      'allows a fixed shared %s target',
      async (executionTarget) => {
        const wsModel = new AgentModel(serverDB, userId, wsId);
        const agent = await wsModel.create({
          title: 'Fixed WS agent',
          agencyConfig: { executionTarget, executionTargetSelectionPolicy: 'fixed' },
        });

        expect(agent.agencyConfig?.executionTargetSelectionPolicy).toBe('fixed');
        expect(agent.agencyConfig?.executionTarget).toBe(executionTarget);
      },
    );

    it('rejects fixing a client-local target for a workspace agent', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      await expect(
        wsModel.create({
          title: 'Invalid fixed WS agent',
          agencyConfig: { executionTarget: 'local', executionTargetSelectionPolicy: 'fixed' },
        }),
      ).rejects.toThrow(/requires a shared execution target/);
    });

    it('rejects fixed policy with a private workspace device', async () => {
      const privateDeviceId = 'workspace-private-device';
      await serverDB.insert(devices).values({
        deviceId: privateDeviceId,
        identitySource: 'machine-id',
        userId,
        visibility: 'private',
        workspaceId: wsId,
      });
      const wsModel = new AgentModel(serverDB, userId, wsId);

      await expect(
        wsModel.create({
          title: 'Private fixed WS agent',
          agencyConfig: {
            boundDeviceId: privateDeviceId,
            executionTargetSelectionPolicy: 'fixed',
            executionTarget: 'device',
          },
        }),
      ).rejects.toThrow(/requires a public device/);
    });
  });

  describe('updateConfig', () => {
    it('enables fixed policy through the normal config update path', async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      const agent = await wsModel.create({
        title: 'WS agent',
        agencyConfig: { boundDeviceId: workspaceDeviceId, executionTarget: 'device' },
      });

      await wsModel.updateConfig(agent.id, {
        agencyConfig: { executionTargetSelectionPolicy: 'fixed' },
      });

      const result = await serverDB.query.agents.findFirst({ where: eq(agents.id, agent.id) });
      expect(result?.agencyConfig?.executionTargetSelectionPolicy).toBe('fixed');
    });

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

  describe('publishToWorkspace', () => {
    const createPrivateFixedAgent = async () => {
      const wsModel = new AgentModel(serverDB, userId, wsId);
      const agent = await wsModel.create({
        agencyConfig: {
          boundDeviceId: workspaceDeviceId,
          executionTargetSelectionPolicy: 'fixed',
          executionTarget: 'device',
        },
        title: 'Private fixed agent',
        visibility: 'private',
      });

      return { agent, wsModel };
    };

    it('publishes a fixed agent while its device is public', async () => {
      const { agent, wsModel } = await createPrivateFixedAgent();

      const published = await wsModel.publishToWorkspace(agent.id);

      expect(published.visibility).toBe('public');
    });

    it('blocks publishing when the fixed device is no longer public', async () => {
      const { agent, wsModel } = await createPrivateFixedAgent();
      await serverDB
        .update(devices)
        .set({ visibility: 'private' })
        .where(eq(devices.deviceId, workspaceDeviceId));

      await expect(wsModel.publishToWorkspace(agent.id)).rejects.toThrow(
        /requires a public device/,
      );

      const stored = await serverDB.query.agents.findFirst({ where: eq(agents.id, agent.id) });
      expect(stored?.visibility).toBe('private');
    });

    it('blocks the direct visibility API from bypassing the fixed-device check', async () => {
      const { agent, wsModel } = await createPrivateFixedAgent();
      await serverDB
        .update(devices)
        .set({ visibility: 'private' })
        .where(eq(devices.deviceId, workspaceDeviceId));

      await expect(wsModel.setVisibility(agent.id, 'public')).rejects.toThrow(
        /requires a public device/,
      );

      const stored = await serverDB.query.agents.findFirst({ where: eq(agents.id, agent.id) });
      expect(stored?.visibility).toBe('private');
    });
  });

  describe('duplicate', () => {
    it('drops stale personal-device bindings when duplicating a workspace agent', async () => {
      // Legacy row predating the workspace-device guard: a public workspace
      // agent whose config still references a personal device (updateConfig
      // grandfathers it on the source, but the copy is a fresh caller-owned
      // row with nothing to grandfather).
      const [sourceAgent] = await serverDB
        .insert(agents)
        .values({
          userId,
          workspaceId: wsId,
          title: 'Legacy WS agent',
          visibility: 'public',
          agencyConfig: {
            boundDeviceId: personalDeviceId,
            executionTargetSelectionPolicy: 'fixed',
            executionTarget: 'device',
            workingDirByDevice: {
              [personalDeviceId]: '/tmp/legacy',
              [workspaceDeviceId]: '/tmp/ws',
            },
          },
        } as NewAgent)
        .returning();

      const wsModel = new AgentModel(serverDB, userId, wsId);
      const result = await wsModel.duplicate(sourceAgent.id);

      const copy = await serverDB.query.agents.findFirst({
        where: eq(agents.id, result!.agentId),
      });
      expect(copy?.agencyConfig?.boundDeviceId).toBeUndefined();
      expect(copy?.agencyConfig?.workingDirByDevice).toEqual({
        [workspaceDeviceId]: '/tmp/ws',
      });
      // The fixed device contract can't be preserved without a valid device:
      // relaxed to the workspace default so the copy resolves the caller's
      // device instead of a stale foreign one.
      expect(copy?.agencyConfig?.executionTargetSelectionPolicy).toBe('member');
    });

    it('preserves a valid fixed workspace-device contract when duplicating', async () => {
      const [sourceAgent] = await serverDB
        .insert(agents)
        .values({
          userId,
          workspaceId: wsId,
          title: 'Fixed WS agent',
          visibility: 'public',
          agencyConfig: {
            boundDeviceId: workspaceDeviceId,
            executionTargetSelectionPolicy: 'fixed',
            executionTarget: 'device',
            workingDirByDevice: { [workspaceDeviceId]: '/tmp/ws' },
          },
        } as NewAgent)
        .returning();

      const wsModel = new AgentModel(serverDB, userId, wsId);
      const result = await wsModel.duplicate(sourceAgent.id);

      const copy = await serverDB.query.agents.findFirst({
        where: eq(agents.id, result!.agentId),
      });
      expect(copy?.agencyConfig).toEqual({
        boundDeviceId: workspaceDeviceId,
        executionTargetSelectionPolicy: 'fixed',
        executionTarget: 'device',
        workingDirByDevice: { [workspaceDeviceId]: '/tmp/ws' },
      });
    });

    it('relaxes a fixed contract bound to a private workspace device when duplicating', async () => {
      const privateDeviceId = 'workspace-private-device';
      await serverDB.insert(devices).values({
        userId,
        workspaceId: wsId,
        deviceId: privateDeviceId,
        identitySource: 'machine-id',
        visibility: 'private',
      });

      const [sourceAgent] = await serverDB
        .insert(agents)
        .values({
          userId,
          workspaceId: wsId,
          title: 'Legacy private-device agent',
          visibility: 'public',
          agencyConfig: {
            boundDeviceId: privateDeviceId,
            executionTargetSelectionPolicy: 'fixed',
            executionTarget: 'device',
          },
        } as NewAgent)
        .returning();

      const wsModel = new AgentModel(serverDB, userId, wsId);
      const result = await wsModel.duplicate(sourceAgent.id);

      const copy = await serverDB.query.agents.findFirst({
        where: eq(agents.id, result!.agentId),
      });
      // Enrolled device stays, but the fixed contract can't be shared with a
      // private device: relaxed to the workspace member default.
      expect(copy?.agencyConfig?.executionTargetSelectionPolicy).toBe('member');
      expect(copy?.agencyConfig?.boundDeviceId).toBe(privateDeviceId);
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

    it('downgrades an invalid fixed local target when moving into a workspace', async () => {
      const personalModel = new AgentModel(serverDB, userId);
      const agent = await personalModel.create({
        title: 'Personal local agent',
        agencyConfig: {
          executionTarget: 'local',
          executionTargetSelectionPolicy: 'fixed',
        },
      });

      await personalModel.transferAgent(agent.id, wsId, userId);

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(result?.agencyConfig?.executionTargetSelectionPolicy).toBe('member');
    });

    it('preserves a fixed sandbox target when moving into a workspace', async () => {
      const personalModel = new AgentModel(serverDB, userId);
      const agent = await personalModel.create({
        title: 'Personal sandbox agent',
        agencyConfig: {
          executionTarget: 'sandbox',
          executionTargetSelectionPolicy: 'fixed',
        },
      });

      await personalModel.transferAgent(agent.id, wsId, userId);

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(result?.agencyConfig?.executionTargetSelectionPolicy).toBe('fixed');
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
