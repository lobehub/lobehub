import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, knowledgeBases, projectCompletionReviews, tasks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ProjectModel } from '../project';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'project-model-user';
const otherUserId = 'project-model-other-user';

describe('ProjectModel', () => {
  const model = new ProjectModel(serverDB, userId);
  const otherModel = new ProjectModel(serverDB, otherUserId);

  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('creates, lists, updates, and deletes a project in the owner scope', async () => {
    const project = await model.create({ description: 'A large effort', name: 'Apollo' });
    expect(project.status).toBe('backlog');
    expect(await model.list()).toEqual([expect.objectContaining({ id: project.id })]);

    const updated = await model.update(project.id, { name: 'Apollo 2' });
    expect(updated?.name).toBe('Apollo 2');
    expect(await model.delete(project.id)).toEqual(expect.objectContaining({ id: project.id }));
    expect(await model.findById(project.id)).toBeNull();
  });

  it('does not expose or mutate another user project in personal mode', async () => {
    const project = await otherModel.create({ name: 'Private effort' });
    expect(await model.findById(project.id)).toBeNull();
    expect(await model.update(project.id, { name: 'Hacked' })).toBeNull();
    expect(await model.delete(project.id)).toBeNull();
  });

  it('binds only accessible agents and knowledge bases', async () => {
    const project = await model.create({ name: 'Bindings' });
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
    const task = await new TaskModel(serverDB, userId).create({
      instruction: 'Use project knowledge',
      projectId: project.id,
    });
    expect(await model.listAgents(project.id)).toEqual([
      expect.objectContaining({ binding: expect.objectContaining({ role: 'lead' }) }),
    ]);
    expect(await model.listKnowledgeBases(project.id)).toHaveLength(1);
    expect(await model.getEnabledKnowledgeBaseIdsForTask(task.id)).toEqual([knowledgeBase.id]);
    await expect(model.addAgent(project.id, { agentId: foreignAgent.id })).rejects.toThrow(
      'Agent not found',
    );

    expect(await model.removeAgent(project.id, agent.id)).toBe(true);
    expect(await model.removeKnowledgeBase(project.id, knowledgeBase.id)).toBe(true);
  });

  it('moves a task subtree into a project', async () => {
    const project = await model.create({ name: 'Tasks' });
    const taskModel = new TaskModel(serverDB, userId);
    const parent = await taskModel.create({ instruction: 'Parent' });
    const child = await taskModel.create({ instruction: 'Child', parentTaskId: parent.id });

    const moved = await model.moveTaskTree(project.id, parent.id);
    expect(moved?.map(({ id }) => id).sort()).toEqual([child.id, parent.id].sort());
    const projectTasks = await model.listTasks(project.id);
    expect(projectTasks?.map(({ id }) => id).sort()).toEqual([child.id, parent.id].sort());
  });

  it('requires review state and records immutable human completion decisions', async () => {
    const project = await model.create({ name: 'Reviewed' });
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

  it('rejects completion requests from invalid states', async () => {
    const project = await model.create({ name: 'Backlog' });
    await expect(model.requestCompletion(project.id)).rejects.toThrow(
      'Only active or paused projects can request completion',
    );
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, project.id))).toEqual([]);
  });
});
