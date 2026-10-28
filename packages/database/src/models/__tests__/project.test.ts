import { randomUUID } from 'node:crypto';

import { INBOX_SESSION_ID } from '@lobechat/const';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  environments,
  knowledgeBases,
  projectAgents,
  projectCompletionReviews,
  projectEnvironments,
  projects,
  projectWorks,
  tasks,
  users,
  works,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import { EnvironmentModel } from '../environment';
import type { CreateProjectInput } from '../project';
import { ProjectModel } from '../project';
import { TaskModel } from '../task';
import { TopicModel } from '../topic';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'project-model-user';
const otherUserId = 'project-model-other-user';
let projectIdentifierSequence = 0;

const createProject = (projectModel: ProjectModel, input: Omit<CreateProjectInput, 'identifier'>) =>
  projectModel.create({
    ...input,
    identifier: `P${String(++projectIdentifierSequence).padStart(5, '0')}`,
  });

describe('ProjectModel', () => {
  const model = new ProjectModel(serverDB, userId);
  const otherModel = new ProjectModel(serverDB, otherUserId);

  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await serverDB.delete(projectEnvironments);
    await serverDB.delete(environments);
    await serverDB.delete(users);
  });

  describe('move', () => {
    // The manual order as the sidebar reads it: sort_order, unplaced first, newest first.
    const ids = async (m: ProjectModel) =>
      (await m.list())
        .toSorted(
          (a, b) =>
            (a.sortOrder ?? -1) - (b.sortOrder ?? -1) ||
            b.updatedAt.getTime() - a.updatedAt.getTime(),
        )
        .map((p) => p.name);

    it('leaves the list API in recently-updated order', async () => {
      const a = await createProject(model, { name: 'A' });
      const b = await createProject(model, { name: 'B' });
      await model.move(a.id, { beforeId: b.id });

      expect((await model.list()).map((p) => p.name)).toEqual(['B', 'A']);
    });

    it('places a project before or after another and keeps the order', async () => {
      const a = await createProject(model, { name: 'A' });
      const b = await createProject(model, { name: 'B' });
      const c = await createProject(model, { name: 'C' });
      expect(await ids(model)).toEqual(['C', 'B', 'A']);

      await model.move(a.id, { beforeId: c.id });
      expect(await ids(model)).toEqual(['A', 'C', 'B']);

      await model.move(a.id, { afterId: b.id });
      expect(await ids(model)).toEqual(['C', 'B', 'A']);
      expect((await model.findById(c.id))?.sortOrder).toBe(0);
    });

    it('lists projects never placed above placed ones', async () => {
      const a = await createProject(model, { name: 'A' });
      const b = await createProject(model, { name: 'B' });
      await model.move(a.id, { beforeId: b.id });
      await createProject(model, { name: 'New' });

      expect(await ids(model)).toEqual(['New', 'A', 'B']);
    });

    it('keeps updatedAt so the recently-updated order does not move', async () => {
      const a = await createProject(model, { name: 'A' });
      const b = await createProject(model, { name: 'B' });
      const before = await model.findByIds([a.id, b.id]);

      await model.move(a.id, { beforeId: b.id });

      for (const row of await model.findByIds([a.id, b.id])) {
        const original = before.find((p) => p.id === row.id)!;
        expect(row.updatedAt.getTime()).toBe(original.updatedAt.getTime());
      }
    });

    it('rejects projects outside the caller scope', async () => {
      const mine = await createProject(model, { name: 'Mine' });
      const theirs = await createProject(otherModel, { name: 'Theirs' });

      await expect(model.move(theirs.id, { beforeId: mine.id })).rejects.toThrow(
        'Project not found',
      );
      expect((await otherModel.findById(theirs.id))?.sortOrder).toBeNull();
    });

    it("keeps each member's private projects in place when another member moves", async () => {
      await serverDB.insert(workspaces).values({
        id: 'project-order-workspace',
        name: 'Project Order Workspace',
        primaryOwnerId: userId,
        slug: 'project-order-workspace',
      });
      const alice = new ProjectModel(serverDB, userId, 'project-order-workspace');
      const bob = new ProjectModel(serverDB, otherUserId, 'project-order-workspace');
      const publicA = await createProject(alice, { name: 'PublicA' });
      const publicB = await createProject(alice, { name: 'PublicB' });
      const privateA = await createProject(alice, { name: 'PrivateA', visibility: 'private' });
      const privateB = await createProject(bob, { name: 'PrivateB', visibility: 'private' });

      await alice.move(privateA.id, { beforeId: publicA.id });
      await alice.move(publicB.id, { afterId: publicA.id });
      expect(await ids(alice)).toEqual(['PrivateA', 'PublicA', 'PublicB']);

      await bob.move(privateB.id, { afterId: publicB.id });

      expect(await ids(alice)).toEqual(['PrivateA', 'PublicA', 'PublicB']);
      expect(await ids(bob)).toEqual(['PublicA', 'PublicB', 'PrivateB']);
    });
  });

  it('lets several projects share one main agent', async () => {
    const shared = await new AgentModel(serverDB, userId).create({ title: 'Planner' });
    const first = await createProject(model, { name: 'First' });
    const second = await createProject(model, { name: 'Second' });

    await serverDB
      .update(projects)
      .set({ coordinatorAgentId: shared.id })
      .where(eq(projects.userId, userId));

    expect((await model.findById(first.id))?.coordinatorAgentId).toBe(shared.id);
    expect((await model.findById(second.id))?.coordinatorAgentId).toBe(shared.id);
  });

  it('keeps a shared main agent when one of its projects is deleted', async () => {
    const shared = await new AgentModel(serverDB, userId).create({ title: 'Planner' });
    const first = await createProject(model, { name: 'First' });
    const second = await createProject(model, { name: 'Second' });
    await serverDB
      .update(projects)
      .set({ coordinatorAgentId: shared.id })
      .where(eq(projects.userId, userId));

    await model.delete(first.id);

    expect(await serverDB.select().from(agents).where(eq(agents.id, shared.id))).toHaveLength(1);
    expect((await model.findById(second.id))?.coordinatorAgentId).toBe(shared.id);
  });

  it('keeps LobeAI when a project led by it is deleted', async () => {
    const inbox = (await new AgentModel(serverDB, userId).getBuiltinAgent(INBOX_SESSION_ID))!;
    const project = await createProject(model, { name: 'Inbox-led' });
    await serverDB
      .update(projects)
      .set({ coordinatorAgentId: inbox.id })
      .where(eq(projects.id, project.id));

    expect(await model.delete(project.id)).toEqual(expect.objectContaining({ id: project.id }));
    expect(await serverDB.select().from(agents).where(eq(agents.id, inbox.id))).toHaveLength(1);
  });

  it('clears the main agent when it is deleted and resolves to LobeAI', async () => {
    const agentModel = new AgentModel(serverDB, userId);
    const agent = await agentModel.create({ title: 'Short-lived' });
    const project = await createProject(model, { name: 'Orphan' });
    await serverDB
      .update(projects)
      .set({ coordinatorAgentId: agent.id })
      .where(eq(projects.id, project.id));

    await agentModel.delete(agent.id);

    const cleared = (await model.findById(project.id))!;
    expect(cleared.coordinatorAgentId).toBeNull();
    const inbox = await agentModel.getBuiltinAgent(INBOX_SESSION_ID);
    expect(await model.resolveCoordinatorAgents([cleared])).toEqual([
      expect.objectContaining({ coordinatorAgentId: inbox?.id, id: project.id }),
    ]);
    expect(await model.delete(project.id)).toEqual(expect.objectContaining({ id: project.id }));
  });

  it('tells whether replacing a main agent retires it', async () => {
    const project = await createProject(model, { name: 'Disposition' });
    const inbox = (await new AgentModel(serverDB, userId).getBuiltinAgent(INBOX_SESSION_ID))!;
    const user = await new AgentModel(serverDB, userId).create({ title: 'Planner' });

    // The project's own lead is ignored only when asked about handing it over.
    expect(
      await model.isDedicatedCoordinator(project.coordinatorAgentId, {
        exceptProjectId: project.id,
      }),
    ).toBe(true);
    expect(await model.isDedicatedCoordinator(project.coordinatorAgentId)).toBe(false);
    // A member of another project is still in use there.
    const other = await createProject(model, { name: 'Borrower' });
    await model.addAgent(other.id, { agentId: project.coordinatorAgentId });
    expect(
      await model.isDedicatedCoordinator(project.coordinatorAgentId, {
        exceptProjectId: project.id,
      }),
    ).toBe(false);
    expect(await model.isDedicatedCoordinator(inbox.id, { exceptProjectId: project.id })).toBe(
      false,
    );
    expect(await model.isDedicatedCoordinator(user.id, { exceptProjectId: project.id })).toBe(
      false,
    );
  });

  it('creates a project led by a picked agent without provisioning a coordinator', async () => {
    const picked = await new AgentModel(serverDB, userId).create({ title: 'Planner' });
    const agentCount = (await serverDB.select().from(agents).where(eq(agents.userId, userId)))
      .length;

    const project = await createProject(model, { coordinatorAgentId: picked.id, name: 'Picked' });

    expect(project.coordinatorAgentId).toBe(picked.id);
    expect(await serverDB.select().from(agents).where(eq(agents.userId, userId))).toHaveLength(
      agentCount,
    );
    expect(
      await serverDB
        .select({ role: projectAgents.role })
        .from(projectAgents)
        .where(eq(projectAgents.projectId, project.id)),
    ).toEqual([{ role: 'coordinator' }]);

    await model.delete(project.id);
    expect(await serverDB.select().from(agents).where(eq(agents.id, picked.id))).toHaveLength(1);
  });

  it('lets the identifier be omitted, keeping the default task prefix', async () => {
    const named = await model.create({ identifier: 'ace', name: 'Named' });
    const unnamed = await model.create({ name: 'Unnamed' });
    const taskModel = new TaskModel(serverDB, userId);

    const namedTask = await taskModel.create({ instruction: 'a', projectId: named.id });
    const unnamedTask = await taskModel.create({ instruction: 'b', projectId: unnamed.id });

    expect(named.identifier).toBe('ACE');
    expect(unnamed.identifier).toBeNull();
    expect(namedTask.identifier).toBe('ACE-1');
    expect(unnamedTask.identifier).toBe('T-2');
  });

  it('refuses to create a project led by an agent outside the scope', async () => {
    const foreign = await new AgentModel(serverDB, otherUserId).create({ title: 'Foreign' });

    await expect(
      createProject(model, { coordinatorAgentId: foreign.id, name: 'Foreign-led' }),
    ).rejects.toThrow('Agent not found');
    expect(await serverDB.select().from(projects).where(eq(projects.userId, userId))).toEqual([]);
  });

  it('creates, lists, updates, and deletes a project in the owner scope', async () => {
    const project = await createProject(model, { description: 'A large effort', name: 'Apollo' });
    expect(project.status).toBe('backlog');
    expect(project.coordinatorAgentId).toBeTruthy();
    expect(
      await serverDB.select().from(agents).where(eq(agents.id, project.coordinatorAgentId)),
    ).toEqual([expect.objectContaining({ virtual: true })]);
    expect(await new AgentModel(serverDB, userId).queryAgents()).not.toContainEqual(
      expect.objectContaining({ id: project.coordinatorAgentId }),
    );
    expect(await model.listAgents(project.id)).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({ id: project.coordinatorAgentId }),
        binding: expect.objectContaining({ role: 'coordinator' }),
      }),
    ]);
    expect(await model.list()).toEqual([expect.objectContaining({ id: project.id })]);

    const updated = await model.update(project.id, { name: 'Apollo 2' });
    expect(updated?.name).toBe('Apollo 2');
    expect(await model.delete(project.id)).toEqual(expect.objectContaining({ id: project.id }));
    expect(await model.findById(project.id)).toBeNull();
    expect(
      await serverDB.select().from(agents).where(eq(agents.id, project.coordinatorAgentId)),
    ).toHaveLength(0);
  });

  it('resolves a project by slug without escaping the current scope', async () => {
    const project = await createProject(model, { name: 'Apollo', slug: 'apollo' });
    await createProject(otherModel, { name: 'Other Apollo', slug: 'other-apollo' });

    expect(await model.findByReference('apollo')).toEqual(
      expect.objectContaining({ id: project.id }),
    );
    expect(await model.findByReference(project.id)).toEqual(
      expect.objectContaining({ slug: 'apollo' }),
    );
    expect(await model.findByReference('other-apollo')).toBeNull();
  });

  it('resolves a project by its identifier, case-insensitively, within the current scope', async () => {
    const project = await model.create({ identifier: 'APLO', name: 'Apollo' });
    await otherModel.create({ identifier: 'OTHR', name: 'Other' });

    expect(await model.findByReference('APLO')).toEqual(
      expect.objectContaining({ id: project.id }),
    );
    expect(await model.findByReference('aplo')).toEqual(
      expect.objectContaining({ id: project.id }),
    );
    expect(await model.findByReference('OTHR')).toBeNull();
  });

  it('prefers an exact id or slug over another project whose identifier matches', async () => {
    const bySlug = await createProject(model, { name: 'By slug', slug: 'crux' });
    await model.create({ identifier: 'CRUX', name: 'By identifier' });

    expect(await model.findByReference('crux')).toEqual(expect.objectContaining({ id: bySlug.id }));
  });

  it('finds a bounded set of readable projects', async () => {
    const first = await createProject(model, { name: 'First' });
    const second = await createProject(model, { name: 'Second' });
    const hidden = await createProject(otherModel, { name: 'Hidden', visibility: 'private' });

    expect(await model.findByIds([])).toEqual([]);
    expect(await model.findByIds([first.id, second.id, hidden.id])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id }),
        expect.objectContaining({ id: second.id }),
      ]),
    );
    expect(await model.findByIds([first.id, second.id, hidden.id])).toHaveLength(2);
  });

  it('normalizes identifiers and enforces uniqueness within their ownership scope', async () => {
    const first = await model.create({ identifier: ' lobe ', name: 'First' });
    expect(first.identifier).toBe('LOBE');

    await expect(model.create({ identifier: 'LOBE', name: 'Duplicate' })).rejects.toThrow();
    await expect(otherModel.create({ identifier: 'LOBE', name: 'Other user' })).resolves.toEqual(
      expect.objectContaining({ identifier: 'LOBE' }),
    );

    await serverDB.insert(workspaces).values({
      id: 'identifier-workspace',
      name: 'Identifier Workspace',
      primaryOwnerId: userId,
      slug: 'identifier-workspace',
    });
    const owner = new ProjectModel(serverDB, userId, 'identifier-workspace');
    const member = new ProjectModel(serverDB, otherUserId, 'identifier-workspace');
    await owner.create({ identifier: 'TEAM', name: 'Workspace project' });
    await expect(
      member.create({ identifier: 'TEAM', name: 'Workspace duplicate' }),
    ).rejects.toThrow();
  });

  it('requires identifiers to contain between 3 and 6 characters', async () => {
    await expect(model.create({ identifier: 'AB', name: 'Too short' })).rejects.toThrow(
      'Project identifier must be between 3 and 6 characters',
    );
    await expect(model.create({ identifier: 'ABCDEFG', name: 'Too long' })).rejects.toThrow(
      'Project identifier must be between 3 and 6 characters',
    );
    await expect(model.create({ identifier: 'ABC', name: 'Minimum' })).resolves.toEqual(
      expect.objectContaining({ identifier: 'ABC' }),
    );
    await expect(model.create({ identifier: 'ABCDEF', name: 'Maximum' })).resolves.toEqual(
      expect.objectContaining({ identifier: 'ABCDEF' }),
    );
  });

  it('filters and paginates projects', async () => {
    await createProject(model, { name: 'Backlog' });
    const active = await createProject(model, { name: 'Active' });
    await model.updateStatus(active.id, 'active');

    expect(await model.list({ limit: 1, offset: 0, statuses: ['active'] })).toEqual([
      expect.objectContaining({ id: active.id }),
    ]);
    expect(await model.list({ statuses: [] })).toHaveLength(2);
    expect(await model.list({ limit: 1, offset: 1 })).toHaveLength(1);
  });

  it('lists projects with their main agent display meta', async () => {
    const project = await createProject(model, { name: 'Apollo' });
    const styled = await createProject(model, { name: 'Gemini' });
    const cleared = await createProject(model, { name: 'Cleared' });
    await serverDB
      .update(agents)
      .set({ avatar: '🚀', backgroundColor: '#000', name: 'Ada' })
      .where(eq(agents.id, styled.coordinatorAgentId));
    await serverDB
      .update(projects)
      .set({ coordinatorAgentId: null })
      .where(eq(projects.id, cleared.id));

    const coordinators = await serverDB
      .select({ avatar: agents.avatar, id: agents.id, title: agents.title })
      .from(agents)
      .where(inArray(agents.id, [project.coordinatorAgentId, styled.coordinatorAgentId]));
    const titleOf = (id: string) => coordinators.find((agent) => agent.id === id)?.title;
    const rows = await model.list();

    // A freshly created coordinator has no avatar; its meta must still be listed.
    expect(
      coordinators.find((agent) => agent.id === project.coordinatorAgentId)?.avatar,
    ).toBeNull();
    expect(rows.find((row) => row.id === project.id)?.coordinatorAgent).toEqual({
      avatar: null,
      backgroundColor: null,
      id: project.coordinatorAgentId,
      name: null,
      title: titleOf(project.coordinatorAgentId),
    });
    expect(rows.find((row) => row.id === styled.id)?.coordinatorAgent).toEqual({
      avatar: '🚀',
      backgroundColor: '#000',
      id: styled.coordinatorAgentId,
      name: 'Ada',
      title: titleOf(styled.coordinatorAgentId),
    });
    expect(rows.find((row) => row.id === cleared.id)?.coordinatorAgent).toBeNull();
  });

  it('does not expose or mutate another user project in personal mode', async () => {
    const project = await createProject(otherModel, { name: 'Private effort' });
    expect(await model.findById(project.id)).toBeNull();
    expect(await model.update(project.id, { name: 'Hacked' })).toBeNull();
    expect(await model.delete(project.id)).toBeNull();
    expect(await model.findManageableById(project.id)).toBeNull();
  });

  it('applies public and private visibility in workspace mode', async () => {
    await serverDB.insert(workspaces).values({
      id: 'project-workspace',
      name: 'Project Workspace',
      primaryOwnerId: userId,
      slug: 'project-workspace',
    });
    const owner = new ProjectModel(serverDB, userId, 'project-workspace');
    const member = new ProjectModel(serverDB, otherUserId, 'project-workspace');
    const publicProject = await createProject(owner, { name: 'Public' });
    const privateProject = await createProject(owner, { name: 'Private', visibility: 'private' });

    expect(await member.findById(publicProject.id)).toEqual(
      expect.objectContaining({ id: publicProject.id }),
    );
    expect(await member.findById(privateProject.id)).toBeNull();
    expect(await member.update(privateProject.id, { name: 'Nope' })).toBeNull();
    expect(await member.delete(privateProject.id)).toBeNull();
  });

  it('lets any workspace member manage a public project another member created', async () => {
    await serverDB.insert(workspaces).values({
      id: 'project-manage-workspace',
      name: 'Project Manage Workspace',
      primaryOwnerId: userId,
      slug: 'project-manage-workspace',
    });
    const owner = new ProjectModel(serverDB, userId, 'project-manage-workspace');
    const member = new ProjectModel(serverDB, otherUserId, 'project-manage-workspace');
    const project = await createProject(owner, { name: 'Shared' });

    expect(await member.findManageableById(project.id)).toEqual(
      expect.objectContaining({ id: project.id }),
    );
    expect(await member.update(project.id, { name: 'Renamed' })).toEqual(
      expect.objectContaining({ name: 'Renamed', userId }),
    );
    expect(await member.updateStatus(project.id, 'active')).toEqual(
      expect.objectContaining({ status: 'active' }),
    );
    // Visibility decides who can see the project, so it stays with the creator.
    expect(await member.update(project.id, { visibility: 'private' })).toBeNull();
    expect(await owner.update(project.id, { visibility: 'private' })).toEqual(
      expect.objectContaining({ visibility: 'private' }),
    );
    await owner.update(project.id, { visibility: 'public' });

    expect(await member.delete(project.id)).toEqual(expect.objectContaining({ id: project.id }));
    expect(await owner.findById(project.id)).toBeNull();
    expect(
      await serverDB.select().from(agents).where(eq(agents.id, project.coordinatorAgentId)),
    ).toHaveLength(0);
  });

  it('lists the main agent first whatever order the other members carry', async () => {
    const project = await createProject(model, { name: 'Ordering' });
    const [agent] = await serverDB
      .insert(agents)
      .values({ title: 'Early bird', userId })
      .returning();
    await model.addAgent(project.id, { agentId: agent.id, sortOrder: -10 });

    expect((await model.listAgents(project.id))?.map(({ agent }) => agent.id)).toEqual([
      project.coordinatorAgentId,
      agent.id,
    ]);
  });

  it('still lists members of a project whose main agent was cleared', async () => {
    const project = await createProject(model, { name: 'Orphaned' });
    const [agent] = await serverDB.insert(agents).values({ title: 'Stays', userId }).returning();
    await model.addAgent(project.id, { agentId: agent.id });
    // Deleting the main agent clears the column (ON DELETE SET NULL).
    await serverDB
      .update(projects)
      .set({ coordinatorAgentId: null })
      .where(eq(projects.id, project.id));

    expect((await model.listAgents(project.id))?.map(({ agent }) => agent.id)).toEqual(
      expect.arrayContaining([agent.id]),
    );
  });

  it('binds only accessible agents and knowledge bases', async () => {
    const project = await createProject(model, { name: 'Bindings' });
    const [agent] = await serverDB
      .insert(agents)
      .values({ title: 'Researcher', userId })
      .returning();
    const [knowledgeBase] = await serverDB
      .insert(knowledgeBases)
      .values({ name: 'Research', userId })
      .returning();
    const [foreignAgent] = await serverDB
      .insert(agents)
      .values({ title: 'Foreign', userId: otherUserId })
      .returning();

    await model.addAgent(project.id, { agentId: agent.id, role: 'lead' });
    await model.addKnowledgeBase(project.id, { knowledgeBaseId: knowledgeBase.id });
    await model.addAgent(project.id, { agentId: agent.id, enabled: false, role: 'reviewer' });
    await model.addKnowledgeBase(project.id, {
      enabled: false,
      knowledgeBaseId: knowledgeBase.id,
      sortOrder: 2,
    });
    const task = await new TaskModel(serverDB, userId).create({
      instruction: 'Use project knowledge',
      projectId: project.id,
    });
    expect(await model.listAgents(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ binding: expect.objectContaining({ role: 'coordinator' }) }),
        expect.objectContaining({ binding: expect.objectContaining({ role: 'reviewer' }) }),
      ]),
    );
    await expect(model.removeAgent(project.id, project.coordinatorAgentId)).rejects.toThrow(
      'The project coordinator cannot be removed',
    );
    expect(await model.listKnowledgeBases(project.id)).toHaveLength(1);
    expect(await model.getEnabledKnowledgeBaseIdsForTask(task.id)).toEqual([]);
    await model.addKnowledgeBase(project.id, { enabled: true, knowledgeBaseId: knowledgeBase.id });
    expect(await model.getEnabledKnowledgeBaseIdsForTask(task.id)).toEqual([knowledgeBase.id]);
    await expect(model.addAgent(project.id, { agentId: foreignAgent.id })).rejects.toThrow(
      'Agent not found',
    );

    expect(await model.removeAgent(project.id, agent.id)).toBe(true);
    expect(await model.removeKnowledgeBase(project.id, knowledgeBase.id)).toBe(true);
    expect(await model.removeAgent(project.id, agent.id)).toBe(false);
    expect(await model.removeKnowledgeBase(project.id, knowledgeBase.id)).toBe(false);
  });

  it('refuses to lead a shared workspace project with a private agent', async () => {
    const workspaceId = 'project-shared-lead-workspace';
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Shared Lead Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    const creator = new ProjectModel(serverDB, userId, workspaceId);
    const [privateAgent] = await serverDB
      .insert(agents)
      .values({ title: 'Private lead', userId, visibility: 'private', workspaceId })
      .returning();

    await expect(
      createProject(creator, {
        coordinatorAgentId: privateAgent.id,
        name: 'Shared-led',
        visibility: 'public',
      }),
    ).rejects.toThrow('A shared project only takes shared agents');
    expect(
      await serverDB.select().from(projects).where(eq(projects.workspaceId, workspaceId)),
    ).toEqual([]);
  });

  // A private binding on a shared project would be filtered out for every reader but its creator.
  it('binds only shared agents and knowledge bases to a shared workspace project', async () => {
    const workspaceId = 'project-shared-binding-workspace';
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Shared Binding Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    const creator = new ProjectModel(serverDB, userId, workspaceId);
    const sharedProject = await createProject(creator, { name: 'Shared' });
    const privateProject = await createProject(creator, { name: 'Mine', visibility: 'private' });
    const [privateAgent] = await serverDB
      .insert(agents)
      .values({ title: 'Private agent', userId, visibility: 'private', workspaceId })
      .returning();
    const [privateKnowledgeBase] = await serverDB
      .insert(knowledgeBases)
      .values({ name: 'Private KB', userId, visibility: 'private', workspaceId })
      .returning();

    await expect(creator.addAgent(sharedProject.id, { agentId: privateAgent.id })).rejects.toThrow(
      'A shared project only takes shared agents',
    );
    await expect(
      creator.addKnowledgeBase(sharedProject.id, { knowledgeBaseId: privateKnowledgeBase.id }),
    ).rejects.toThrow('A shared project only takes shared knowledge bases');

    expect(await creator.addAgent(privateProject.id, { agentId: privateAgent.id })).toEqual(
      expect.objectContaining({ agentId: privateAgent.id }),
    );
    expect(
      await creator.addKnowledgeBase(privateProject.id, {
        knowledgeBaseId: privateKnowledgeBase.id,
      }),
    ).toEqual(expect.objectContaining({ knowledgeBaseId: privateKnowledgeBase.id }));
  });

  it('updates member and knowledge bindings without touching the coordinator', async () => {
    const project = await createProject(model, { name: 'Patch bindings' });
    const [agent] = await serverDB.insert(agents).values({ title: 'Writer', userId }).returning();
    const [knowledgeBase] = await serverDB
      .insert(knowledgeBases)
      .values({ name: 'Notes', userId })
      .returning();
    await model.addAgent(project.id, { agentId: agent.id, role: 'writer' });
    await model.addKnowledgeBase(project.id, { knowledgeBaseId: knowledgeBase.id });

    expect(
      await model.updateAgent(project.id, agent.id, { enabled: false, responsibility: 'Docs' }),
    ).toEqual(expect.objectContaining({ enabled: false, responsibility: 'Docs', role: 'writer' }));
    expect(await model.updateAgent(project.id, 'missing-agent', { enabled: false })).toBeNull();
    await expect(
      model.updateAgent(project.id, project.coordinatorAgentId, { enabled: false }),
    ).rejects.toThrow('The project coordinator is managed by the project');
    await expect(
      model.addAgent(project.id, { agentId: project.coordinatorAgentId, enabled: false }),
    ).rejects.toThrow('The project coordinator is managed by the project');

    expect(await model.getEnabledKnowledgeBaseIds(project.id)).toEqual([knowledgeBase.id]);
    expect(
      await model.updateKnowledgeBase(project.id, knowledgeBase.id, { enabled: false }),
    ).toEqual(expect.objectContaining({ enabled: false }));
    expect(await model.getEnabledKnowledgeBaseIds(project.id)).toEqual([]);
    expect(await model.updateKnowledgeBase(project.id, 'missing-kb', { enabled: true })).toBeNull();
  });

  it('lets workspace admins manage members and every reader manage knowledge', async () => {
    await serverDB.insert(workspaces).values({
      id: 'project-member-workspace',
      name: 'Project Member Workspace',
      primaryOwnerId: userId,
      slug: 'project-member-workspace',
    });
    const workspaceId = 'project-member-workspace';
    const creator = new ProjectModel(serverDB, userId, workspaceId);
    const member = new ProjectModel(serverDB, otherUserId, workspaceId);
    const admin = new ProjectModel(serverDB, otherUserId, workspaceId, {
      canManageAllMembers: true,
    });
    const project = await createProject(creator, { name: 'Shared' });
    const [agent] = await serverDB
      .insert(agents)
      .values({ title: 'Shared agent', userId, visibility: 'public', workspaceId })
      .returning();
    const [knowledgeBase] = await serverDB
      .insert(knowledgeBases)
      .values({ name: 'Shared KB', userId, visibility: 'public', workspaceId })
      .returning();

    expect(member.getPermissions(project)).toEqual({
      canManage: true,
      canManageKnowledgeBases: true,
      canManageMembers: false,
    });
    expect(admin.getPermissions(project)).toEqual(
      expect.objectContaining({ canManage: true, canManageMembers: true }),
    );
    expect(creator.getPermissions(project)).toEqual(
      expect.objectContaining({ canManage: true, canManageMembers: true }),
    );

    expect(await member.addAgent(project.id, { agentId: agent.id })).toBeNull();
    expect(await admin.addAgent(project.id, { agentId: agent.id, role: 'lead' })).toEqual(
      expect.objectContaining({ agentId: agent.id, role: 'lead' }),
    );
    expect(await member.removeAgent(project.id, agent.id)).toBe(false);
    expect(await admin.updateAgent(project.id, agent.id, { role: 'reviewer' })).toEqual(
      expect.objectContaining({ role: 'reviewer' }),
    );
    expect(await admin.update(project.id, { name: 'Renamed by admin' })).toEqual(
      expect.objectContaining({ name: 'Renamed by admin' }),
    );
    // Member management stays with the creator and workspace admins.
    expect(await member.findMembersManageableById(project.id)).toBeNull();
    expect(await admin.findMembersManageableById(project.id)).toEqual(
      expect.objectContaining({ id: project.id }),
    );

    expect(
      await member.addKnowledgeBase(project.id, { knowledgeBaseId: knowledgeBase.id }),
    ).toEqual(expect.objectContaining({ knowledgeBaseId: knowledgeBase.id }));
    expect(await member.removeKnowledgeBase(project.id, knowledgeBase.id)).toBe(true);
    expect(await admin.removeAgent(project.id, agent.id)).toBe(true);
  });

  it('reports no management permissions to a read-only caller, even the creator', async () => {
    await serverDB.insert(workspaces).values({
      id: 'project-viewer-workspace',
      name: 'Project Viewer Workspace',
      primaryOwnerId: userId,
      slug: 'project-viewer-workspace',
    });
    const workspaceId = 'project-viewer-workspace';
    const project = await createProject(new ProjectModel(serverDB, userId, workspaceId), {
      name: 'Viewed',
    });
    const downgradedCreator = new ProjectModel(serverDB, userId, workspaceId, { readOnly: true });
    const viewer = new ProjectModel(serverDB, otherUserId, workspaceId, { readOnly: true });

    for (const model of [downgradedCreator, viewer]) {
      expect(model.getPermissions(project)).toEqual({
        canManage: false,
        canManageKnowledgeBases: false,
        canManageMembers: false,
      });
    }
  });

  it('lets every member who can see a project file work in it', async () => {
    const workspaceId = 'project-task-workspace';
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Task Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    const creator = new ProjectModel(serverDB, userId, workspaceId);
    const project = await createProject(creator, { name: 'Shared work' });
    const privateProject = await createProject(creator, { name: 'Solo', visibility: 'private' });
    const memberTasks = new TaskModel(serverDB, otherUserId, workspaceId);

    expect(await memberTasks.create({ instruction: 'Pitch in', projectId: project.id })).toEqual(
      expect.objectContaining({ identifier: `${project.identifier}-1` }),
    );
    await expect(
      memberTasks.create({ instruction: 'Sneak in', projectId: privateProject.id }),
    ).rejects.toThrow('Project not found');
  });

  it('returns null or false for binding operations on inaccessible projects and resources', async () => {
    const foreignProject = await createProject(otherModel, { name: 'Foreign' });
    const [foreignKnowledgeBase] = await serverDB
      .insert(knowledgeBases)
      .values({ name: 'Foreign KB', userId: otherUserId })
      .returning();
    const [foreignWork] = await serverDB
      .insert(works)
      .values({
        resourceId: 'foreign-work',
        resourceType: 'github_issue',
        toolIdentifier: 'github',
        toolName: 'create_issue',
        type: 'external',
        userId: otherUserId,
        visibility: 'private',
      })
      .returning();

    expect(await model.listAgents(foreignProject.id)).toBeNull();
    expect(await model.listKnowledgeBases(foreignProject.id)).toBeNull();
    expect(await model.listWorks(foreignProject.id)).toBeNull();
    expect(await model.listTasks(foreignProject.id)).toBeNull();
    expect(await model.listCompletionReviews(foreignProject.id)).toBeNull();
    expect(await model.addAgent(foreignProject.id, { agentId: 'missing' })).toBeNull();
    expect(
      await model.addKnowledgeBase(foreignProject.id, { knowledgeBaseId: foreignKnowledgeBase.id }),
    ).toBeNull();
    expect(await model.removeAgent(foreignProject.id, 'missing')).toBe(false);
    expect(await model.removeKnowledgeBase(foreignProject.id, foreignKnowledgeBase.id)).toBe(false);
    expect(await model.addWork(foreignProject.id, { workId: 'missing' })).toBeNull();
    expect(await model.removeWork(foreignProject.id, 'missing')).toBe(false);

    const project = await createProject(model, { name: 'Local' });
    await expect(
      model.addKnowledgeBase(project.id, { knowledgeBaseId: foreignKnowledgeBase.id }),
    ).rejects.toThrow('Knowledge base not found');
    await expect(model.addWork(project.id, { workId: foreignWork.id })).rejects.toThrow(
      'Work not found',
    );
  });

  it('associates one durable Work with multiple projects without changing Work ownership', async () => {
    const firstProject = await createProject(model, { name: 'First Work Project' });
    const secondProject = await createProject(model, { name: 'Second Work Project' });
    const [work] = await serverDB
      .insert(works)
      .values({
        resourceId: 'lobehub/lobehub#1',
        resourceType: 'github_pull_request',
        toolIdentifier: 'github',
        toolName: 'create_pull_request',
        type: 'external',
        userId,
        visibility: 'private',
      })
      .returning();

    await model.addWork(firstProject.id, { sortOrder: 2, workId: work.id });
    await model.addWork(secondProject.id, { workId: work.id });
    await model.addWork(firstProject.id, { sortOrder: 1, workId: work.id });

    expect(await model.listWorks(firstProject.id)).toEqual([
      expect.objectContaining({
        binding: expect.objectContaining({ sortOrder: 1 }),
        work: expect.objectContaining({ id: work.id }),
      }),
    ]);
    expect(
      await serverDB.select().from(projectWorks).where(eq(projectWorks.workId, work.id)),
    ).toHaveLength(2);

    expect(await model.removeWork(firstProject.id, work.id)).toBe(true);
    expect(await model.removeWork(firstProject.id, work.id)).toBe(false);
    expect(await model.listWorks(secondProject.id)).toHaveLength(1);
    expect(await serverDB.select().from(works).where(eq(works.id, work.id))).toHaveLength(1);
  });

  it('enforces project boundaries in the shared dependency model path', async () => {
    const firstProject = await createProject(model, { name: 'First' });
    const secondProject = await createProject(model, { name: 'Second' });
    const taskModel = new TaskModel(serverDB, userId);
    const first = await taskModel.create({ instruction: 'First', projectId: firstProject.id });
    const second = await taskModel.create({ instruction: 'Second', projectId: secondProject.id });

    await expect(taskModel.addDependency(first.id, second.id)).rejects.toThrow(
      'Task dependencies cannot cross project boundaries',
    );
    await expect(taskModel.addDependency(first.id, 'missing')).rejects.toThrow('Task not found');
  });

  it('requires review state and records immutable human completion decisions', async () => {
    const project = await createProject(model, { name: 'Reviewed' });
    await model.updateStatus(project.id, 'active');
    await model.requestCompletion(project.id);

    const rejected = await model.reviewCompletion(project.id, 'rejected', 'Needs evidence');
    expect(rejected?.project.status).toBe('active');
    expect(rejected?.review.round).toBe(1);

    await model.requestCompletion(project.id);
    const accepted = await model.reviewCompletion(project.id, 'accepted', 'Approved');
    expect(accepted?.project.status).toBe('completed');
    expect(accepted?.project.completedReviewId).toBe(accepted?.review.id);
    expect(accepted?.review.round).toBe(2);

    const reviews = await model.listCompletionReviews(project.id);
    expect(reviews?.map(({ decision }) => decision)).toEqual(['accepted', 'rejected']);
    expect(
      await serverDB
        .select()
        .from(projectCompletionReviews)
        .where(
          and(
            eq(projectCompletionReviews.projectId, project.id),
            eq(projectCompletionReviews.reviewerUserId, userId),
          ),
        ),
    ).toHaveLength(2);

    const reopened = await model.reopen(project.id);
    expect(reopened).toEqual(
      expect.objectContaining({ completedAt: null, completedReviewId: null, status: 'active' }),
    );
  });

  it('requires reopen for completed projects even after archival', async () => {
    const project = await createProject(model, { name: 'Archived completion' });
    await model.updateStatus(project.id, 'active');
    await model.requestCompletion(project.id);
    await model.reviewCompletion(project.id, 'accepted');
    await model.updateStatus(project.id, 'archived');

    await expect(model.updateStatus(project.id, 'active')).rejects.toThrow(
      'An archived completed project must be reopened',
    );
    expect(await model.reopen(project.id)).toEqual(
      expect.objectContaining({ completedReviewId: null, status: 'active' }),
    );
  });

  it('covers lifecycle guards and missing review targets', async () => {
    const project = await createProject(model, { name: 'Lifecycle' });
    expect(await model.updateStatus('missing', 'active')).toBeNull();
    await expect(model.updateStatus(project.id, 'completed')).rejects.toThrow(
      'Completion states must be changed through the review workflow',
    );
    await expect(model.updateStatus(project.id, 'reviewing')).rejects.toThrow(
      'Completion states must be changed through the review workflow',
    );
    await model.updateStatus(project.id, 'active');
    const startedAt = (await model.findById(project.id))?.startedAt;
    await model.updateStatus(project.id, 'paused');
    await model.updateStatus(project.id, 'active');
    expect((await model.findById(project.id))?.startedAt).toEqual(startedAt);
    await model.requestCompletion(project.id);
    await expect(model.updateStatus(project.id, 'paused')).rejects.toThrow(
      'A project awaiting review must be accepted or rejected',
    );
    await expect(model.reviewCompletion('missing', 'accepted')).resolves.toBeNull();
    await expect(model.reviewCompletion(project.id, 'rejected')).resolves.toEqual(
      expect.objectContaining({ project: expect.objectContaining({ status: 'active' }) }),
    );
    await expect(model.reviewCompletion(project.id, 'accepted')).rejects.toThrow(
      'Project is not awaiting review',
    );
    expect(await model.reopen(project.id)).toBeNull();
  });

  it('handles completed transitions and a concurrent deletion during status update', async () => {
    const completed = await createProject(model, { name: 'Completed' });
    await model.updateStatus(completed.id, 'active');
    await model.requestCompletion(completed.id);
    await model.reviewCompletion(completed.id, 'accepted');
    await expect(model.updateStatus(completed.id, 'active')).rejects.toThrow(
      'A completed project must be reopened',
    );

    const disappearing = await createProject(model, { name: 'Disappearing' });
    const snapshot = await model.findManageableById(disappearing.id);
    await serverDB.delete(projects).where(eq(projects.id, disappearing.id));
    vi.spyOn(model, 'findManageableById').mockResolvedValueOnce(snapshot);
    expect(await model.updateStatus(disappearing.id, 'active')).toBeNull();
  });

  it('rejects completion requests from invalid states', async () => {
    const project = await createProject(model, { name: 'Backlog' });
    await expect(model.requestCompletion(project.id)).rejects.toThrow(
      'Only active or paused projects can request completion',
    );
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, project.id))).toEqual([]);
    expect(await model.requestCompletion('missing')).toBeNull();
    expect(await model.getEnabledKnowledgeBaseIdsForTask('missing')).toEqual([]);
    const standaloneTask = await new TaskModel(serverDB, userId).create({
      instruction: 'Standalone',
    });
    expect(await model.getEnabledKnowledgeBaseIdsForTask(standaloneTask.id)).toEqual([]);
  });

  it('attaches environments and lists them per project in the owner scope', async () => {
    const project = await createProject(model, { name: 'Env host' });
    const environmentModel = new EnvironmentModel(serverDB, userId);
    const env = await environmentModel.save({
      name: 'Shared GitHub',
      repositoryUrl: 'https://github.com/lobehub/lobehub',
    });
    expect(await model.listEnvironments(project.id)).toEqual([]);
    await model.attachEnvironment(project.id, env.id);
    await model.attachEnvironment(project.id, env.id);
    expect(await model.listEnvironments(project.id)).toEqual([
      expect.objectContaining({ id: env.id }),
    ]);
    await expect(otherModel.attachEnvironment(project.id, env.id)).rejects.toThrow('access denied');
    await expect(otherModel.listEnvironments(project.id)).rejects.toThrow('access denied');
    await expect(model.attachEnvironment(project.id, randomUUID())).rejects.toThrow(
      'access denied',
    );
  });

  it('lists project conversations with or without directories, retaining each agent', async () => {
    const project = await createProject(model, { name: 'Topics host' });
    const topicModel = new TopicModel(serverDB, userId);
    const plain = await topicModel.create({
      agentId: project.coordinatorAgentId,
      projectId: project.id,
      title: 'Planning',
    });
    const work = await topicModel.create({
      agentId: project.coordinatorAgentId,
      favorite: true,
      metadata: { workingDirectory: '/work/repo' },
      projectId: project.id,
      title: 'Implementation',
    });
    const list = await model.listTopics(project.id);
    expect(list).toHaveLength(2);
    expect(list.find((t) => t.id === plain.id)).toMatchObject({
      agentId: project.coordinatorAgentId,
      projectWorkingDirectoryId: null,
    });
    expect(list.find((t) => t.id === work.id)).toMatchObject({
      agentId: project.coordinatorAgentId,
      createdAt: expect.any(Date),
      favorite: true,
      metadata: expect.objectContaining({ workingDirectory: '/work/repo' }),
      userId,
    });
    await expect(otherModel.listTopics(project.id)).rejects.toThrow('access denied');
  });

  it("carries each agent's execution-target pin on its project topics", async () => {
    const project = await createProject(model, { name: 'Pinned host' });
    const [pinned] = await serverDB
      .insert(agents)
      .values({
        agencyConfig: { boundDeviceId: 'device-mac', executionTargetSelectionPolicy: 'fixed' },
        title: 'Pinned',
        userId,
      })
      .returning();
    const topicModel = new TopicModel(serverDB, userId);
    await topicModel.create({ agentId: pinned.id, projectId: project.id, title: 'Pinned work' });
    await topicModel.create({
      agentId: project.coordinatorAgentId,
      projectId: project.id,
      title: 'Free work',
    });

    const list = await model.listTopics(project.id);
    expect(list.find((t) => t.agentId === pinned.id)).toMatchObject({
      agentBoundDeviceId: 'device-mac',
      agentExecutionTargetSelectionPolicy: 'fixed',
    });
    expect(list.find((t) => t.agentId === project.coordinatorAgentId)).toMatchObject({
      agentBoundDeviceId: null,
      agentExecutionTargetSelectionPolicy: null,
    });
  });

  it("carries each agent's heterogeneous provider type on its project topics", async () => {
    const project = await createProject(model, { name: 'External runtime' });
    const [external] = await serverDB
      .insert(agents)
      .values({
        agencyConfig: { heterogeneousProvider: { command: 'claude', type: 'claude-code' } },
        title: 'Claude Code',
        userId,
      })
      .returning();
    const topicModel = new TopicModel(serverDB, userId);
    await topicModel.create({ agentId: external.id, projectId: project.id, title: 'External' });
    await topicModel.create({
      agentId: project.coordinatorAgentId,
      projectId: project.id,
      title: 'Built-in',
    });

    const list = await model.listTopics(project.id);
    expect(list.find((t) => t.agentId === external.id)).toMatchObject({
      agentHeterogeneousProviderType: 'claude-code',
    });
    expect(list.find((t) => t.agentId === project.coordinatorAgentId)).toMatchObject({
      agentHeterogeneousProviderType: null,
    });
  });

  it('keeps agentless conversations visible in project listings', async () => {
    const project = await createProject(model, { name: 'Agentless host' });
    const topic = await new TopicModel(serverDB, userId).create({
      projectId: project.id,
      title: 'Agentless',
    });
    expect(await model.listTopics(project.id)).toEqual([
      expect.objectContaining({ agentId: null, agentTitle: null, id: topic.id }),
    ]);
  });
});
