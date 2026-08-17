// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentAccountBindings,
  agentBotProviders,
  agentCronJobs,
  agentDocuments,
  agentHistoryJobs,
  agentLabelAssignments,
  agentLabels,
  agentProviderAccounts,
  agents,
  agentsFiles,
  agentsKnowledgeBases,
  chatGroups,
  chatGroupsAgents,
  devices,
  documents,
  expertiseBindings,
  expertiseDomains,
  files,
  knowledgeBases,
  projectAgents,
  projects,
  tasks,
  topicDocuments,
  topics,
  userConnectors,
  userConnectorTools,
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
  // Job rows deliberately have no FK onto their owners (guards must observe a
  // pending job, not have it cascade away), so clean them explicitly or they
  // leak into sibling suites sharing this DB.
  await serverDB.delete(agentHistoryJobs);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: recipientId }, { id: teammateId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: wsId, name: 'Handover WS', primaryOwnerId: ownerId, slug: 'handover-ws' }]);
});

afterEach(async () => {
  delete process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD;
  await serverDB.delete(agentHistoryJobs);
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

  it('detaches knowledge mounts the recipient cannot access, keeps the rest', async () => {
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
      {
        fileType: 'text/plain',
        id: 'file-public',
        name: 'shared.txt',
        size: 1,
        url: 'f/shared',
        userId: ownerId,
        visibility: 'public',
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(agentsFiles).values([
      ...['file-owner-private', 'file-public'].map((fileId) => ({
        agentId: agent.id,
        fileId,
        userId: ownerId,
        workspaceId: wsId,
      })),
      // The recipient ALREADY mounted the public file themselves: the
      // previous owner's duplicate row must merge away, not violate the
      // (fileId, agentId, userId) primary key on re-home.
      { agentId: agent.id, fileId: 'file-public', userId: recipientId, workspaceId: wsId },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    // The previous owner's PRIVATE KB and file are unreachable for the new
    // owner — their mounts must go rather than survive as dead links the
    // runtime silently skips. Public ones and the recipient's own private KB
    // keep working and stay mounted — re-homed to the recipient, so the
    // junction's user-deletion cascade no longer ties them to the previous
    // owner's account.
    const kbMounts = await serverDB
      .select({ id: agentsKnowledgeBases.knowledgeBaseId, userId: agentsKnowledgeBases.userId })
      .from(agentsKnowledgeBases)
      .where(eq(agentsKnowledgeBases.agentId, agent.id));
    expect(kbMounts.map((row) => row.id).sort()).toEqual(['kb-public', 'kb-recipient-private']);
    expect(kbMounts.every((row) => row.userId === recipientId)).toBe(true);
    const fileMounts = await serverDB
      .select({ id: agentsFiles.fileId, userId: agentsFiles.userId })
      .from(agentsFiles)
      .where(eq(agentsFiles.agentId, agent.id));
    expect(fileMounts).toEqual([{ id: 'file-public', userId: recipientId }]);
  });

  it('disconnects agent-owned connectors and unmounts other members’ linked ones', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(userConnectors).values([
      // The previous owner's agent-owned connector: its OAuth credentials are
      // personal identity and must NOT travel — the row re-homes as a
      // disconnected shell the recipient reauthorizes.
      {
        agentId: agent.id,
        credentials: 'encrypted-owner-oauth',
        id: '00000000-0000-4000-8000-00000000c001',
        identifier: 'linear',
        isEnabled: true,
        metadata: {
          composio: {
            appSlug: 'linear',
            authConfigId: 'ac_1',
            connectedAccountId: 'ca_owner_1',
            linkedByUserId: ownerId,
            redirectUrl: 'https://composio/redirect',
            status: 'ACTIVE',
          },
        },
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
        userId: ownerId,
        workspaceId: wsId,
      },
      // A teammate's personal base connector mounted by this agent: unmounts,
      // but the row stays the teammate's, untouched otherwise.
      {
        credentials: 'encrypted-teammate-oauth',
        id: '00000000-0000-4000-8000-00000000c002',
        identifier: 'github',
        isEnabled: true,
        metadata: { mountedByAgentId: agent.id },
        name: 'GitHub',
        sourceType: 'builtin',
        status: 'connected',
        userId: teammateId,
        workspaceId: wsId,
      },
      // The recipient's own agent-owned connector: already theirs, untouched.
      {
        agentId: agent.id,
        credentials: 'encrypted-recipient-oauth',
        id: '00000000-0000-4000-8000-00000000c003',
        identifier: 'notion',
        isEnabled: true,
        name: 'Notion',
        sourceType: 'builtin',
        status: 'connected',
        userId: recipientId,
        workspaceId: wsId,
      },
    ]);

    await serverDB.insert(userConnectorTools).values([
      {
        crudType: 'write',
        permission: 'auto',
        toolName: 'create_issue',
        userConnectorId: '00000000-0000-4000-8000-00000000c001',
        userId: ownerId,
      },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    const rows = await serverDB.select().from(userConnectors);
    const shell = rows.find((row) => row.identifier === 'linear');
    expect(shell).toMatchObject({
      credentials: null,
      isEnabled: false,
      status: 'disconnected',
      userId: recipientId,
    });
    // Composio ACCOUNT fields go with the credentials (a retained
    // connectedAccountId would let the recipient operate on the previous
    // owner's remote connection); config fields survive for reauthorization.
    expect(shell?.metadata?.composio).toEqual({
      appSlug: 'linear',
      authConfigId: 'ac_1',
      status: 'PENDING',
    });
    // The denormalized tool rows re-home with their parent connector, or the
    // previous owner's account deletion would cascade them away.
    const toolRows = await serverDB
      .select()
      .from(userConnectorTools)
      .where(eq(userConnectorTools.userConnectorId, '00000000-0000-4000-8000-00000000c001'));
    expect(toolRows).toHaveLength(1);
    expect(toolRows[0].userId).toBe(recipientId);
    const mounted = rows.find((row) => row.identifier === 'github');
    expect(mounted?.userId).toBe(teammateId);
    expect(mounted?.credentials).toBe('encrypted-teammate-oauth');
    expect(mounted?.metadata?.mountedByAgentId).toBeUndefined();
    const recipientOwn = rows.find((row) => row.identifier === 'notion');
    expect(recipientOwn).toMatchObject({
      credentials: 'encrypted-recipient-oauth',
      isEnabled: true,
      status: 'connected',
      userId: recipientId,
    });
  });

  it('leaves other members’ projects when a PRIVATE agent is handed over', async () => {
    const agent = await ownerModel.create({ title: 'Agent', visibility: 'private' });
    const coordinatorA = await ownerModel.create({ title: 'Coord A', visibility: 'public' });
    const coordinatorB = await ownerModel.create({ title: 'Coord B', visibility: 'public' });
    await serverDB.insert(projects).values([
      {
        coordinatorAgentId: coordinatorA.id,
        id: 'proj-teammate',
        identifier: 'PRJT1',
        name: 'T',
        userId: teammateId,
        workspaceId: wsId,
      },
      {
        coordinatorAgentId: coordinatorB.id,
        id: 'proj-recipient',
        identifier: 'PRJR1',
        name: 'R',
        userId: recipientId,
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(projectAgents).values([
      { agentId: agent.id, projectId: 'proj-teammate', workspaceId: wsId },
      { agentId: agent.id, projectId: 'proj-recipient', workspaceId: wsId },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    // The teammate's project would keep a silent hole (project listings apply
    // member-agent visibility) — the link goes explicitly. The recipient's
    // own project keeps resolving the agent and stays linked.
    const links = await serverDB
      .select({ projectId: projectAgents.projectId })
      .from(projectAgents)
      .where(eq(projectAgents.agentId, agent.id));
    expect(links.map((row) => row.projectId)).toEqual(['proj-recipient']);
  });

  it('keeps a dedicated-provenance document bound to a TOPIC with its owner', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(documents).values([
      {
        content: 'topic-shared skill',
        fileType: 'text/markdown',
        filename: 'topic-shared.md',
        id: 'doc-vfs-topic',
        source: `agent-document://${agent.id}/topic-shared.md`,
        sourceType: 'agent',
        title: 'topic shared',
        totalCharCount: 18,
        totalLineCount: 1,
        userId: ownerId,
        visibility: 'public',
        workspaceId: wsId,
      },
    ]);
    await serverDB
      .insert(agentDocuments)
      .values([
        { agentId: agent.id, documentId: 'doc-vfs-topic', userId: ownerId, workspaceId: wsId },
      ]);
    await serverDB
      .insert(topics)
      .values([{ agentId: agent.id, id: 'topic-doc-ref', userId: ownerId, workspaceId: wsId }]);
    await serverDB.insert(topicDocuments).values([
      {
        documentId: 'doc-vfs-topic',
        topicId: 'topic-doc-ref',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    // The TOPIC consumer makes it shared content: the document must not be
    // yanked from the topic's owner; only the agent binding re-homes.
    const [doc] = await serverDB.select().from(documents).where(eq(documents.id, 'doc-vfs-topic'));
    expect(doc.userId).toBe(ownerId);
    const [link] = await serverDB
      .select()
      .from(agentDocuments)
      .where(eq(agentDocuments.agentId, agent.id));
    expect(link.userId).toBe(recipientId);
  });

  it('re-homes the previous owner’s label assignments and exclusive labels', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    const otherAgent = await ownerModel.create({ title: 'Other Agent' });
    await serverDB.insert(agentLabels).values([
      // Assigned ONLY to the transferred agent: the label row itself re-homes,
      // or the previous owner's deletion cascades it (and the assignment) away.
      {
        id: '00000000-0000-4000-8000-00000000e001',
        name: 'important',
        userId: ownerId,
        workspaceId: wsId,
      },
      // Shared with ANOTHER agent: stays with its creator (workspace taxonomy).
      {
        id: '00000000-0000-4000-8000-00000000e002',
        name: 'shared-tag',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(agentLabelAssignments).values([
      {
        agentId: agent.id,
        labelId: '00000000-0000-4000-8000-00000000e001',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId: agent.id,
        labelId: '00000000-0000-4000-8000-00000000e002',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId: otherAgent.id,
        labelId: '00000000-0000-4000-8000-00000000e002',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    // Attribution only — but both columns cascade on user deletion, so they
    // must follow the agent to the recipient.
    const assignments = await serverDB
      .select()
      .from(agentLabelAssignments)
      .where(eq(agentLabelAssignments.agentId, agent.id));
    expect(assignments).toHaveLength(2);
    expect(assignments.every((row) => row.userId === recipientId)).toBe(true);
    const labels = await serverDB.select().from(agentLabels);
    expect(labels.find((l) => l.id === '00000000-0000-4000-8000-00000000e001')?.userId).toBe(
      recipientId,
    );
    expect(labels.find((l) => l.id === '00000000-0000-4000-8000-00000000e002')?.userId).toBe(
      ownerId,
    );
  });

  it('re-homes the previous owner’s quota account bindings, still enabled', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    const otherAgent = await ownerModel.create({ title: 'Other Agent' });
    await serverDB.insert(agentProviderAccounts).values([
      // Consumed ONLY by the transferred agent: the account row itself
      // re-homes, or the previous owner's deletion cascades it (and with it
      // the binding) away.
      {
        id: '00000000-0000-4000-8000-00000000a001',
        provider: 'anthropic',
        userId: ownerId,
        workspaceId: wsId,
      },
      // Shared with ANOTHER agent's binding: stays with its observer.
      {
        id: '00000000-0000-4000-8000-00000000a002',
        provider: 'openai',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(agentAccountBindings).values([
      {
        accountId: '00000000-0000-4000-8000-00000000a001',
        agentId: agent.id,
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        accountId: '00000000-0000-4000-8000-00000000a002',
        agentId: agent.id,
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        accountId: '00000000-0000-4000-8000-00000000a002',
        agentId: otherAgent.id,
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    // Attribution only: left with the previous owner, their account deletion
    // would cascade the agent's account selection away. Stays ENABLED — the
    // binding selects a workspace quota account, it runs nothing under the
    // previous owner's identity.
    const bindings = await serverDB
      .select()
      .from(agentAccountBindings)
      .where(eq(agentAccountBindings.agentId, agent.id));
    expect(bindings).toHaveLength(2);
    expect(bindings.every((b) => b.userId === recipientId && b.enabled)).toBe(true);
    const accounts = await serverDB.select().from(agentProviderAccounts);
    // Exclusively-consumed account re-homes; the shared one stays observed by
    // the previous owner (shared workspace capacity, not transfer-specific).
    expect(accounts.find((a) => a.id === '00000000-0000-4000-8000-00000000a001')?.userId).toBe(
      recipientId,
    );
    expect(accounts.find((a) => a.id === '00000000-0000-4000-8000-00000000a002')?.userId).toBe(
      ownerId,
    );
  });

  it('re-homes agent-exclusive private expertise, unbinds shared domains', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(expertiseDomains).values([
      {
        domainFilter: 'f',
        id: 'dom-exclusive',
        slug: 'dom-exclusive',
        title: 'Exclusive',
        userId: ownerId,
        visibility: 'private',
        workspaceId: wsId,
      },
      {
        domainFilter: 'f',
        id: 'dom-shared',
        slug: 'dom-shared',
        title: 'Shared',
        userId: ownerId,
        visibility: 'private',
        workspaceId: wsId,
      },
      {
        domainFilter: 'f',
        id: 'dom-public',
        slug: 'dom-public',
        title: 'Public',
        userId: ownerId,
        visibility: 'public',
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(expertiseBindings).values([
      { agentId: agent.id, domainId: 'dom-exclusive', workspaceId: wsId },
      { agentId: agent.id, domainId: 'dom-shared', workspaceId: wsId },
      // The shared domain is ALSO bound at member level — it stays the
      // previous owner's; only the transferred agent's binding goes.
      { boundUserId: ownerId, domainId: 'dom-shared', workspaceId: wsId },
      { agentId: agent.id, domainId: 'dom-public', workspaceId: wsId },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    const domains = await serverDB.select().from(expertiseDomains);
    // Bound only to the transferred agent: its learned expertise travels.
    expect(domains.find((d) => d.id === 'dom-exclusive')?.userId).toBe(recipientId);
    // Bound elsewhere too: stays with its owner…
    expect(domains.find((d) => d.id === 'dom-shared')?.userId).toBe(ownerId);
    // …and the agent's binding is removed explicitly, not left invisible.
    const bindings = await serverDB
      .select()
      .from(expertiseBindings)
      .where(eq(expertiseBindings.agentId, agent.id));
    expect(bindings.map((b) => b.domainId).sort()).toEqual(['dom-exclusive', 'dom-public']);
    // Public domains resolve for everyone: untouched.
    expect(domains.find((d) => d.id === 'dom-public')?.userId).toBe(ownerId);
  });

  it('re-homes the previous owner’s VFS documents with the agent', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    const otherAgent = await ownerModel.create({ title: 'Other Agent' });
    await serverDB.insert(documents).values([
      // DEDICATED provenance but ALSO associated to another agent since: the
      // external consumer makes it shared content — ownership must not move.
      {
        content: 'shared skill',
        fileType: 'text/markdown',
        filename: 'shared-skill.md',
        id: 'doc-vfs-shared',
        source: `agent-document://x/shared-skill.md`,
        sourceType: 'agent',
        title: 'shared skill',
        totalCharCount: 12,
        totalLineCount: 1,
        userId: ownerId,
        visibility: 'public',
        workspaceId: wsId,
      },
      {
        content: 'skill body',
        fileType: 'text/markdown',
        filename: 'skill.md',
        id: 'doc-vfs-1',
        source: `agent-document://${agent.id}/skill.md`,
        sourceType: 'agent',
        title: 'skill',
        totalCharCount: 10,
        totalLineCount: 1,
        userId: ownerId,
        workspaceId: wsId,
      },
      // ASSOCIATED pre-existing personal document, private to the previous
      // owner: never changes hands; the binding detaches instead.
      {
        content: 'my notes',
        fileType: 'text/markdown',
        filename: 'notes.md',
        id: 'doc-assoc-private',
        source: 'editor',
        sourceType: 'file',
        title: 'notes',
        totalCharCount: 8,
        totalLineCount: 1,
        userId: ownerId,
        visibility: 'private',
        workspaceId: wsId,
      },
      // ASSOCIATED workspace-public document: stays the owner's; only the
      // binding row re-homes so it survives the owner's account deletion.
      {
        content: 'shared reference',
        fileType: 'text/markdown',
        filename: 'ref.md',
        id: 'doc-assoc-public',
        source: 'editor',
        sourceType: 'file',
        title: 'ref',
        totalCharCount: 16,
        totalLineCount: 1,
        userId: ownerId,
        visibility: 'public',
        workspaceId: wsId,
      },
      // DEDICATED skill bundle: created via createWithTx but with a CUSTOM
      // source — the creation type ('agent-signal'), not the source string,
      // marks it as the agent's own file.
      {
        content: 'skill bundle',
        fileType: 'text/markdown',
        filename: 'bundle.md',
        id: 'doc-skill-bundle',
        source: 'agent-signal:skill-management',
        sourceType: 'agent-signal',
        title: 'bundle',
        totalCharCount: 12,
        totalLineCount: 1,
        userId: ownerId,
        workspaceId: wsId,
      },
      // Verify criterion instruction: stamps sourceType 'agent' but is a
      // STANDALONE document — its foreign source must keep it associated, so
      // it never changes owner (private → binding detaches).
      {
        content: 'criterion text',
        fileType: 'verify/instruction',
        filename: 'criterion.md',
        id: 'doc-criterion',
        source: 'verify-criterion:adhoc:0',
        sourceType: 'agent',
        title: 'criterion',
        totalCharCount: 14,
        totalLineCount: 1,
        userId: ownerId,
        visibility: 'private',
        workspaceId: wsId,
      },
      // ASSOCIATED public document the RECIPIENT has ALSO bound themselves:
      // the previous owner's duplicate binding must merge away, not collide
      // with the (agent, document, user) uniqueness on re-home.
      {
        content: 'both bound',
        fileType: 'text/markdown',
        filename: 'both.md',
        id: 'doc-assoc-dup',
        source: 'editor',
        sourceType: 'file',
        title: 'both',
        totalCharCount: 10,
        totalLineCount: 1,
        userId: ownerId,
        visibility: 'public',
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(agentDocuments).values([
      ...[
        'doc-vfs-1',
        'doc-assoc-private',
        'doc-assoc-public',
        'doc-skill-bundle',
        'doc-assoc-dup',
        'doc-criterion',
        'doc-vfs-shared',
      ].map((documentId) => ({
        agentId: agent.id,
        documentId,
        userId: ownerId,
        workspaceId: wsId,
      })),
      { agentId: agent.id, documentId: 'doc-assoc-dup', userId: recipientId, workspaceId: wsId },
      // The external consumer that keeps doc-vfs-shared from re-homing.
      { agentId: otherAgent.id, documentId: 'doc-vfs-shared', userId: ownerId, workspaceId: wsId },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    const links = await serverDB
      .select()
      .from(agentDocuments)
      .where(eq(agentDocuments.agentId, agent.id));
    // The private associated + criterion bindings are gone; the owner's
    // duplicate binding merged into the recipient's own; everything left
    // belongs to the recipient.
    expect(links.map((row) => row.documentId).sort()).toEqual([
      'doc-assoc-dup',
      'doc-assoc-public',
      'doc-skill-bundle',
      'doc-vfs-1',
      'doc-vfs-shared',
    ]);
    expect(links.every((row) => row.userId === recipientId)).toBe(true);
    const docRows = await serverDB.select().from(documents);
    // DEDICATED agent files change owner — including the skill bundle with a
    // custom source (their user_id would cascade the skills away with the
    // previous owner's account) …
    expect(docRows.find((d) => d.id === 'doc-vfs-1')?.userId).toBe(recipientId);
    expect(docRows.find((d) => d.id === 'doc-skill-bundle')?.userId).toBe(recipientId);
    // … while associated personal documents always stay the owner's.
    expect(docRows.find((d) => d.id === 'doc-assoc-private')?.userId).toBe(ownerId);
    expect(docRows.find((d) => d.id === 'doc-assoc-public')?.userId).toBe(ownerId);
    expect(docRows.find((d) => d.id === 'doc-assoc-dup')?.userId).toBe(ownerId);
    // sourceType 'agent' alone must NOT transfer a standalone criterion doc.
    expect(docRows.find((d) => d.id === 'doc-criterion')?.userId).toBe(ownerId);
    // Dedicated provenance with an EXTERNAL binding: shared content, stays put.
    expect(docRows.find((d) => d.id === 'doc-vfs-shared')?.userId).toBe(ownerId);
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

  it('leaves other members’ groups when a PRIVATE agent is handed over', async () => {
    const agent = await ownerModel.create({ title: 'Private', visibility: 'private' });
    await serverDB.insert(chatGroups).values([
      { id: 'teammate-group', title: 'T', userId: teammateId, workspaceId: wsId },
      { id: 'recipient-group', title: 'R', userId: recipientId, workspaceId: wsId },
    ]);
    await serverDB.insert(chatGroupsAgents).values([
      {
        agentId: agent.id,
        chatGroupId: 'teammate-group',
        role: 'participant',
        userId: teammateId,
        workspaceId: wsId,
      },
      {
        agentId: agent.id,
        chatGroupId: 'recipient-group',
        role: 'participant',
        userId: recipientId,
        workspaceId: wsId,
      },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    const links = await serverDB.select().from(chatGroupsAgents);
    // The teammate's group cannot render a private agent it no longer sees —
    // the link is removed explicitly; the recipient's own group keeps it.
    expect(links.some((l) => l.chatGroupId === 'teammate-group')).toBe(false);
    expect(links.some((l) => l.chatGroupId === 'recipient-group')).toBe(true);
  });

  it('refuses handover of an agent with an OWNED group membership', async () => {
    const agent = await ownerModel.create({ title: 'Supervisor' });
    await serverDB
      .insert(chatGroups)
      .values([{ id: 'own-group', title: 'G', userId: ownerId, workspaceId: wsId }]);
    await serverDB.insert(chatGroupsAgents).values([
      {
        agentId: agent.id,
        chatGroupId: 'own-group',
        role: 'supervisor',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);

    await expect(
      handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId }),
    ).rejects.toThrow('AGENT_OWNED_BY_GROUP');
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
    // Re-homed rows arrive DISABLED: the recipient must consciously re-enable
    // before anything runs under their identity and budget.
    expect(cronRows.find((j) => j.id === 'owner-cron')?.userId).toBe(recipientId);
    expect(cronRows.find((j) => j.id === 'owner-cron')?.enabled).toBe(false);
    expect(cronRows.find((j) => j.id === 'teammate-cron')?.userId).toBe(teammateId);
    expect(cronRows.find((j) => j.id === 'teammate-cron')?.enabled).toBe(true);

    const botRows = await serverDB.select().from(agentBotProviders);
    expect(botRows.find((b) => b.applicationId === 'app-owner')?.userId).toBe(recipientId);
    expect(botRows.find((b) => b.applicationId === 'app-owner')?.enabled).toBe(false);
    expect(botRows.find((b) => b.applicationId === 'app-teammate')?.userId).toBe(teammateId);
    expect(botRows.find((b) => b.applicationId === 'app-teammate')?.enabled).toBe(true);
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
