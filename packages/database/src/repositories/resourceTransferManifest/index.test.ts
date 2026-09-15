// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { AgentModel } from '../../models/agent';
import { ChatGroupModel } from '../../models/chatGroup';
import {
  agentBotProviders,
  agentCronJobs,
  agents,
  agentsFiles,
  agentsKnowledgeBases,
  chatGroupsAgents,
  devices,
  expertiseBindings,
  expertiseDomains,
  files,
  knowledgeBases,
  tasks,
  userConnectors,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildMemberTransferManifest } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'manifest-owner';
const recipientId = 'manifest-recipient';
const teammateId = 'manifest-teammate';
const wsId = 'manifest-ws';

const ownerModel = new AgentModel(serverDB, ownerId, wsId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: recipientId }, { id: teammateId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: wsId, name: 'Manifest WS', primaryOwnerId: ownerId, slug: 'manifest-ws' }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('buildMemberTransferManifest', () => {
  it('reports the owner’s bots/cron, device binding, and detachable tasks for a private agent', async () => {
    const agent = await ownerModel.create({ title: 'Agent', visibility: 'private' });
    await serverDB
      .update(agents)
      .set({ agencyConfig: { boundDeviceId: 'dev-1' } })
      .where(eq(agents.id, agent.id));
    await serverDB.insert(agentBotProviders).values([
      {
        agentId: agent.id,
        applicationId: 'app-1',
        platform: 'discord',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId: agent.id,
        applicationId: 'app-2',
        platform: 'slack',
        userId: teammateId,
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(agentCronJobs).values([
      {
        agentId: agent.id,
        content: 'daily',
        cronPattern: '0 9 * * *',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(tasks).values([
      {
        assigneeAgentId: agent.id,
        createdByUserId: ownerId,
        identifier: 'M-1',
        instruction: 'owner task',
        seq: 1,
        workspaceId: wsId,
      },
      {
        assigneeAgentId: agent.id,
        createdByUserId: recipientId,
        identifier: 'M-2',
        instruction: 'recipient task (stays attached)',
        seq: 2,
        workspaceId: wsId,
      },
    ]);

    const manifest = await buildMemberTransferManifest(serverDB, {
      recipientId,
      resourceId: agent.id,
      resourceType: 'agent',
      workspaceId: wsId,
    });

    expect(manifest).toEqual({
      // Only the OWNER's bot rides along; the teammate's slack binding stays.
      botBindings: 1,
      botPlatforms: ['discord'],
      cronJobs: 1,
      // dev-1 is not enrolled anywhere the recipient can reach → sanitation
      // would strip it, so the reset warning is real.
      connectorsAffected: 0,
      deviceBindingAffected: true,
      expertiseAffected: 0,
      groupsToLeave: 0,
      hiddenReferencedMember: false,
      knowledgeToDetach: 0,
      ownerId,
      projectsToLeave: 0,
      tasksToDetach: 1,
    });
  });

  it('does not warn about device bindings the recipient can actually reach', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(devices).values([
      {
        deviceId: 'public-dev',
        identitySource: 'machine-id',
        userId: ownerId,
        visibility: 'public',
        workspaceId: wsId,
      },
    ]);
    await serverDB
      .update(agents)
      .set({ agencyConfig: { boundDeviceId: 'public-dev' } })
      .where(eq(agents.id, agent.id));

    const manifest = await buildMemberTransferManifest(serverDB, {
      recipientId,
      resourceId: agent.id,
      resourceType: 'agent',
      workspaceId: wsId,
    });

    // The binding survives recipient-aware sanitation → no false reset warning.
    expect(manifest?.deviceBindingAffected).toBe(false);
  });

  it('counts only knowledge mounts the recipient cannot access', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(knowledgeBases).values([
      {
        id: 'kb-owner-private',
        name: 'A',
        userId: ownerId,
        visibility: 'private',
        workspaceId: wsId,
      },
      { id: 'kb-public', name: 'B', userId: ownerId, visibility: 'public', workspaceId: wsId },
      {
        id: 'kb-recipient-private',
        name: 'C',
        userId: recipientId,
        visibility: 'private',
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(agentsKnowledgeBases).values(
      ['kb-owner-private', 'kb-public', 'kb-recipient-private'].map((knowledgeBaseId) => ({
        agentId: agent.id,
        knowledgeBaseId,
        userId: ownerId,
        workspaceId: wsId,
      })),
    );
    await serverDB.insert(files).values([
      {
        fileType: 'text/plain',
        id: 'file-owner-private',
        name: 'notes.txt',
        size: 1,
        url: 'f/notes',
        userId: ownerId,
        visibility: 'private',
        workspaceId: wsId,
      },
    ]);
    await serverDB
      .insert(agentsFiles)
      .values([
        { agentId: agent.id, fileId: 'file-owner-private', userId: ownerId, workspaceId: wsId },
      ]);

    const manifest = await buildMemberTransferManifest(serverDB, {
      recipientId,
      resourceId: agent.id,
      resourceType: 'agent',
      workspaceId: wsId,
    });

    // Owner-private KB + owner-private file are invisible to the recipient;
    // the public KB and the recipient's own private KB are not.
    expect(manifest?.knowledgeToDetach).toBe(2);
  });

  it('counts agent-owned and mounted connectors the handover will affect', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(userConnectors).values([
      {
        agentId: agent.id,
        id: '00000000-0000-4000-8000-00000000d001',
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        id: '00000000-0000-4000-8000-00000000d002',
        identifier: 'github',
        metadata: { mountedByAgentId: agent.id },
        name: 'GitHub',
        sourceType: 'builtin',
        status: 'connected',
        userId: teammateId,
        workspaceId: wsId,
      },
      // The recipient's own agent-owned connector is unaffected — not counted.
      {
        agentId: agent.id,
        id: '00000000-0000-4000-8000-00000000d003',
        identifier: 'notion',
        name: 'Notion',
        sourceType: 'builtin',
        status: 'connected',
        userId: recipientId,
        workspaceId: wsId,
      },
    ]);

    const manifest = await buildMemberTransferManifest(serverDB, {
      recipientId,
      resourceId: agent.id,
      resourceType: 'agent',
      workspaceId: wsId,
    });

    expect(manifest?.connectorsAffected).toBe(2);
  });

  it('counts private expertise domains the recipient cannot see', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(expertiseDomains).values([
      {
        domainFilter: 'f',
        id: 'mdom-private',
        slug: 'mdom-private',
        title: 'Private',
        userId: ownerId,
        visibility: 'private',
        workspaceId: wsId,
      },
      {
        domainFilter: 'f',
        id: 'mdom-public',
        slug: 'mdom-public',
        title: 'Public',
        userId: ownerId,
        visibility: 'public',
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(expertiseBindings).values([
      { agentId: agent.id, domainId: 'mdom-private', workspaceId: wsId },
      { agentId: agent.id, domainId: 'mdom-public', workspaceId: wsId },
    ]);

    const manifest = await buildMemberTransferManifest(serverDB, {
      recipientId,
      resourceId: agent.id,
      resourceType: 'agent',
      workspaceId: wsId,
    });

    // Only the domain the recipient cannot see counts; public ones keep working.
    expect(manifest?.expertiseAffected).toBe(1);
  });

  it('flags a group whose referenced member is private to someone else', async () => {
    const groupModel = new ChatGroupModel(serverDB, ownerId, wsId);
    const group = await groupModel.create({ title: 'Group', visibility: 'public' });
    const [referenced] = await serverDB
      .insert(agents)
      .values({
        title: 'Standalone',
        userId: teammateId,
        virtual: false,
        visibility: 'private',
        workspaceId: wsId,
      })
      .returning();
    await serverDB.insert(chatGroupsAgents).values([
      {
        agentId: referenced.id,
        chatGroupId: group.id,
        role: 'participant',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);

    const manifest = await buildMemberTransferManifest(serverDB, {
      recipientId,
      resourceId: group.id,
      resourceType: 'agentGroup',
      workspaceId: wsId,
    });

    expect(manifest?.hiddenReferencedMember).toBe(true);
    // Referenced members are not owned: nothing of theirs rides along.
    expect(manifest?.botPlatforms).toEqual([]);
  });

  it('returns null for a resource outside the workspace', async () => {
    await expect(
      buildMemberTransferManifest(serverDB, {
        recipientId,
        resourceId: 'missing',
        resourceType: 'agent',
        workspaceId: wsId,
      }),
    ).resolves.toBeNull();
  });
});
