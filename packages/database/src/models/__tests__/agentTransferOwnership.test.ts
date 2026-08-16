// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentBotProviders,
  agentCronJobs,
  agents,
  devices,
  tasks,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AGENT_OWNERSHIP_STALE, AgentModel } from '../agent';
import { AGENT_TRANSFER_IN_PROGRESS, AgentTransferJobModel } from '../agentTransferJob';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'handover-owner';
const recipientId = 'handover-recipient';
const teammateId = 'handover-teammate';
const wsId = 'handover-ws';

const ownerModel = new AgentModel(serverDB, ownerId, wsId);
const recipientModel = new AgentModel(serverDB, recipientId, wsId);

const handover = (params: Parameters<AgentModel['transferAgentOwnership']>[1]) =>
  serverDB.transaction(async (trx) => recipientModel.transferAgentOwnership(trx, params));

beforeEach(async () => {
  delete process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD;
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: recipientId }, { id: teammateId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: wsId, name: 'Handover WS', primaryOwnerId: ownerId, slug: 'handover-ws' }]);
});

afterEach(async () => {
  delete process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD;
  await serverDB.delete(users);
});

describe('AgentModel.transferAgentOwnership', () => {
  it('flips only the agent owner; scope, slug and visibility stay put', async () => {
    const agent = await ownerModel.create({
      slug: 'handover-agent',
      title: 'Handover Agent',
      visibility: 'public',
    });

    await handover({
      agentId: agent.id,
      fromUserId: ownerId,
      toUserId: recipientId,
    });

    const [updated] = await serverDB.select().from(agents).where(eq(agents.id, agent.id));
    expect(updated.userId).toBe(recipientId);
    expect(updated.workspaceId).toBe(wsId);
    expect(updated.slug).toBe('handover-agent');
    expect(updated.visibility).toBe('public');
  });

  it('keeps everyone’s conversations untouched', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(topics).values([
      { agentId: agent.id, id: 'owner-topic', userId: ownerId, workspaceId: wsId },
      { agentId: agent.id, id: 'teammate-topic', userId: teammateId, workspaceId: wsId },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    const rows = await serverDB.select().from(topics);
    expect(rows.find((t) => t.id === 'owner-topic')?.userId).toBe(ownerId);
    expect(rows.find((t) => t.id === 'teammate-topic')?.userId).toBe(teammateId);
  });

  it('drops a binding to another member’s PRIVATE workspace device, keeps public ones', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(devices).values([
      {
        deviceId: 'owner-private-ws-device',
        identitySource: 'machine-id',
        userId: ownerId,
        visibility: 'private',
        workspaceId: wsId,
      },
      {
        deviceId: 'public-ws-device',
        identitySource: 'machine-id',
        userId: ownerId,
        visibility: 'public',
        workspaceId: wsId,
      },
    ]);
    await serverDB
      .update(agents)
      .set({
        agencyConfig: {
          boundDeviceId: 'owner-private-ws-device',
          workingDirByDevice: {
            'owner-private-ws-device': '/home/owner',
            'public-ws-device': '/srv/shared',
          },
        },
      })
      .where(eq(agents.id, agent.id));

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    const [updated] = await serverDB.select().from(agents).where(eq(agents.id, agent.id));
    // The previous owner's private workspace enrollment is invisible to the
    // recipient; only the public device survives the handover.
    expect(updated.agencyConfig?.boundDeviceId).toBeUndefined();
    expect(updated.agencyConfig?.workingDirByDevice).toEqual({ 'public-ws-device': '/srv/shared' });
  });

  it('detaches other users’ tasks from a PRIVATE agent, keeps public-agent tasks intact', async () => {
    const privateAgent = await ownerModel.create({ title: 'Private', visibility: 'private' });
    const publicAgent = await ownerModel.create({ title: 'Public', visibility: 'public' });
    await serverDB.insert(tasks).values([
      {
        assigneeAgentId: privateAgent.id,
        createdByUserId: ownerId,
        identifier: 'TASK-1',
        instruction: 'owner task on private agent',
        seq: 1,
        workspaceId: wsId,
      },
      {
        assigneeAgentId: privateAgent.id,
        createdByUserId: recipientId,
        identifier: 'TASK-2',
        instruction: 'recipient task on private agent',
        seq: 2,
        workspaceId: wsId,
      },
      {
        assigneeAgentId: publicAgent.id,
        createdByUserId: ownerId,
        identifier: 'TASK-3',
        instruction: 'owner task on public agent',
        seq: 3,
        workspaceId: wsId,
      },
    ]);

    await handover({ agentId: privateAgent.id, fromUserId: ownerId, toUserId: recipientId });
    await handover({ agentId: publicAgent.id, fromUserId: ownerId, toUserId: recipientId });

    const taskRows = await serverDB.select().from(tasks);
    // Ownership never changes; only unusable private-agent assignments detach.
    expect(taskRows.find((t) => t.identifier === 'TASK-1')?.createdByUserId).toBe(ownerId);
    expect(taskRows.find((t) => t.identifier === 'TASK-1')?.assigneeAgentId).toBeNull();
    expect(taskRows.find((t) => t.identifier === 'TASK-2')?.assigneeAgentId).toBe(privateAgent.id);
    expect(taskRows.find((t) => t.identifier === 'TASK-3')?.assigneeAgentId).toBe(publicAgent.id);
  });

  it('re-homes the previous owner’s cron jobs and bot providers, not teammates’', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(agentCronJobs).values([
      {
        agentId: agent.id,
        content: 'daily report',
        cronPattern: '0 9 * * *',
        id: 'owner-cron',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId: agent.id,
        content: 'teammate digest',
        cronPattern: '0 8 * * *',
        id: 'teammate-cron',
        userId: teammateId,
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(agentBotProviders).values([
      {
        agentId: agent.id,
        applicationId: 'app-owner',
        platform: 'discord',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId: agent.id,
        applicationId: 'app-teammate',
        platform: 'slack',
        userId: teammateId,
        workspaceId: wsId,
      },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    const cronRows = await serverDB.select().from(agentCronJobs);
    expect(cronRows.find((j) => j.id === 'owner-cron')?.userId).toBe(recipientId);
    expect(cronRows.find((j) => j.id === 'teammate-cron')?.userId).toBe(teammateId);

    const botRows = await serverDB.select().from(agentBotProviders);
    expect(botRows.find((b) => b.applicationId === 'app-owner')?.userId).toBe(recipientId);
    expect(botRows.find((b) => b.applicationId === 'app-teammate')?.userId).toBe(teammateId);
  });

  it('strips device bindings the recipient cannot reach', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB
      .update(agents)
      .set({
        agencyConfig: {
          boundDeviceId: 'owner-personal-device',
          executionTarget: 'device',
          executionTargetSelectionPolicy: 'fixed',
          workingDirByDevice: { 'owner-personal-device': '/home/owner' },
        },
      })
      .where(eq(agents.id, agent.id));

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    const [updated] = await serverDB.select().from(agents).where(eq(agents.id, agent.id));
    expect(updated.userId).toBe(recipientId);
    // The personal device is not enrolled in the workspace: binding, per-device
    // working dirs, and the fixed-device policy are all re-homed.
    expect(updated.agencyConfig?.boundDeviceId).toBeUndefined();
    expect(updated.agencyConfig?.workingDirByDevice).toBeUndefined();
    expect(updated.agencyConfig?.executionTargetSelectionPolicy).toBe('member');
  });

  it('refuses while a cross-scope backfill job still covers the agent', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.transaction((trx) =>
      AgentTransferJobModel.createJob(trx, {
        agentIds: [agent.id],
        sessionIds: [],
        source: { userId: ownerId, workspaceId: wsId },
        target: { userId: teammateId, workspaceId: wsId },
        topics: [],
      }),
    );

    await expect(
      handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId }),
    ).rejects.toThrow(AGENT_TRANSFER_IN_PROGRESS);
  });

  it('rejects a stale request when the owner already changed', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.update(agents).set({ userId: teammateId }).where(eq(agents.id, agent.id));

    await expect(
      handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId }),
    ).rejects.toThrow(AGENT_OWNERSHIP_STALE);
  });

  it('rejects when the agent is no longer in the workspace', async () => {
    const personalModel = new AgentModel(serverDB, ownerId);
    const agent = await personalModel.create({ title: 'Personal Agent' });

    await expect(
      handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId }),
    ).rejects.toThrow(AGENT_OWNERSHIP_STALE);
  });
});
