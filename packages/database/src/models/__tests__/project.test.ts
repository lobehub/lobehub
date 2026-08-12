import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  knowledgeBases,
  projectCompletionReviews,
  projects,
  tasks,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import type { CreateProjectInput } from '../project';
import { ProjectModel } from '../project';
import { TaskModel } from '../task';

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
    await serverDB.delete(users);
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
    expect(await member.update(publicProject.id, { name: 'Nope' })).toBeNull();
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

  it('returns null or false for binding operations on inaccessible projects and resources', async () => {
    const foreignProject = await createProject(otherModel, { name: 'Foreign' });
    const [foreignKnowledgeBase] = await serverDB
      .insert(knowledgeBases)
      .values({ name: 'Foreign KB', userId: otherUserId })
      .returning();

    expect(await model.listAgents(foreignProject.id)).toBeNull();
    expect(await model.listKnowledgeBases(foreignProject.id)).toBeNull();
    expect(await model.listTasks(foreignProject.id)).toBeNull();
    expect(await model.listCompletionReviews(foreignProject.id)).toBeNull();
    expect(await model.addAgent(foreignProject.id, { agentId: 'missing' })).toBeNull();
    expect(
      await model.addKnowledgeBase(foreignProject.id, { knowledgeBaseId: foreignKnowledgeBase.id }),
    ).toBeNull();
    expect(await model.removeAgent(foreignProject.id, 'missing')).toBe(false);
    expect(await model.removeKnowledgeBase(foreignProject.id, foreignKnowledgeBase.id)).toBe(false);

    const project = await createProject(model, { name: 'Local' });
    await expect(
      model.addKnowledgeBase(project.id, { knowledgeBaseId: foreignKnowledgeBase.id }),
    ).rejects.toThrow('Knowledge base not found');
  });

  it('moves a task subtree into a project', async () => {
    const project = await createProject(model, { name: 'Tasks' });
    const taskModel = new TaskModel(serverDB, userId);
    const parent = await taskModel.create({ instruction: 'Parent' });
    const child = await taskModel.create({ instruction: 'Child', parentTaskId: parent.id });

    const moved = await model.moveTaskTree(project.id, parent.id);
    expect(moved?.map(({ id }) => id).sort()).toEqual([child.id, parent.id].sort());
    const projectTasks = await model.listTasks(project.id);
    expect(projectTasks?.map(({ id }) => id).sort()).toEqual([child.id, parent.id].sort());
  });

  it('preserves project tree boundaries when moving tasks', async () => {
    const source = await createProject(model, { name: 'Source' });
    const target = await createProject(model, { name: 'Target' });
    const taskModel = new TaskModel(serverDB, userId);
    const parent = await taskModel.create({ instruction: 'Parent', projectId: source.id });
    const child = await taskModel.create({
      instruction: 'Child',
      parentTaskId: parent.id,
      projectId: source.id,
    });

    await expect(model.moveTaskTree(target.id, child.id)).rejects.toThrow(
      'Cannot move a task away from its parent project',
    );
    await serverDB.update(tasks).set({ projectId: target.id }).where(eq(tasks.id, parent.id));
    expect(await model.moveTaskTree(target.id, child.id)).toEqual([
      expect.objectContaining({ id: child.id }),
    ]);
    await expect(model.moveTaskTree(target.id, 'missing')).rejects.toThrow('Task not found');
    expect(await model.moveTaskTree('missing', child.id)).toBeNull();
  });

  it('rejects moving a workspace task tree with descendants created by another member', async () => {
    await serverDB.insert(workspaces).values({
      id: 'mixed-tree-workspace',
      name: 'Mixed Tree',
      primaryOwnerId: userId,
      slug: 'mixed-tree-workspace',
    });
    const workspaceModel = new ProjectModel(serverDB, userId, 'mixed-tree-workspace');
    const ownerTasks = new TaskModel(serverDB, userId, 'mixed-tree-workspace');
    const memberTasks = new TaskModel(serverDB, otherUserId, 'mixed-tree-workspace');
    const project = await createProject(workspaceModel, { name: 'Target' });
    const parent = await ownerTasks.create({ instruction: 'Parent' });
    await memberTasks.create({
      instruction: 'Member child',
      parentTaskId: parent.id,
      visibility: 'private',
    });

    await expect(workspaceModel.moveTaskTree(project.id, parent.id)).rejects.toThrow(
      'Cannot move a task tree containing tasks created by another user',
    );
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
});
