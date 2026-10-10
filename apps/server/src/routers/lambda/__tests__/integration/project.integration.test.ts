// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, knowledgeBases, tasks } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { asc, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectRouter } from '../../project';
import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

describe('Project Router Integration', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let caller: ReturnType<typeof projectRouter.createCaller>;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    caller = projectRouter.createCaller(createTestContext(userId));
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  it('serves the complete project management and human review flow', async () => {
    const created = await caller.create({
      identifier: 'apollo',
      name: 'Apollo',
      visibility: 'private',
    });
    expect(created.data.identifier).toBe('APOLLO');
    expect(created.data.coordinatorAgentId).toBeTruthy();
    await caller.updateStatus({ id: created.data.id, status: 'active' });

    const [agent] = await serverDB.insert(agents).values({ title: 'Lead', userId }).returning();
    const [knowledgeBase] = await serverDB
      .insert(knowledgeBases)
      .values({ name: 'Mission data', userId })
      .returning();
    await caller.addAgent({ agentId: agent.id, id: created.data.id, role: 'lead' });
    await caller.addKnowledgeBase({ id: created.data.id, knowledgeBaseId: knowledgeBase.id });

    const taskCaller = taskRouter.createCaller(createTestContext(userId));
    const task = await taskCaller.create({
      instruction: 'Prepare launch',
      projectId: created.data.id,
    });
    const detail = await caller.detail({ id: created.data.id });
    expect(detail.data.agents).toHaveLength(2);
    expect(detail.data.agents).toContainEqual(
      expect.objectContaining({
        agent: expect.objectContaining({ id: created.data.coordinatorAgentId }),
        binding: expect.objectContaining({ role: 'coordinator' }),
      }),
    );
    expect(detail.data.knowledgeBases).toHaveLength(1);
    expect(detail.data.tasks?.[0].id).toBe(task.data.id);

    await caller.requestCompletion({ id: created.data.id });
    const completed = await caller.acceptCompletion({
      comment: 'Human approved',
      id: created.data.id,
    });
    expect(completed.data.project.status).toBe('completed');
    expect(completed.data.review.reviewerUserId).toBe(userId);

    const reopened = await caller.reopen({ id: created.data.id });
    expect(reopened.data.status).toBe('active');
  });

  it('rejects cross-project task dependencies', async () => {
    const first = await caller.create({ identifier: 'FIRST', name: 'First' });
    const second = await caller.create({ identifier: 'SECOND', name: 'Second' });
    const taskCaller = taskRouter.createCaller(createTestContext(userId));
    const firstTask = await taskCaller.create({ instruction: 'First', projectId: first.data.id });
    const secondTask = await taskCaller.create({
      instruction: 'Second',
      projectId: second.data.id,
    });

    await expect(
      taskCaller.addDependency({ dependsOnId: secondTask.data.id, taskId: firstTask.data.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it.each([true, false])(
    'rejects moving a task tree without changing any rows (has project: %s)',
    async (hasProject) => {
      const source = hasProject
        ? await caller.create({ identifier: 'SOURCE', name: 'Source' })
        : undefined;
      const target = await caller.create({ identifier: 'TARGET', name: 'Target' });
      const taskCaller = taskRouter.createCaller(createTestContext(userId));
      const parent = await taskCaller.create({
        instruction: 'Parent',
        projectId: source?.data.id,
      });
      const child = await taskCaller.create({
        instruction: 'Child',
        parentTaskId: parent.data.id,
      });
      const ids = [parent.data.id, child.data.id];
      const readTree = () =>
        serverDB.select().from(tasks).where(inArray(tasks.id, ids)).orderBy(asc(tasks.id));
      const before = await readTree();
      expect(before).toHaveLength(2);
      for (const task of before) {
        expect(task.projectId).toBe(source?.data.id ?? null);
        expect(task.identifier).toBeTruthy();
      }

      // Released clients can still call the old procedure with its original input.
      for (const taskId of ids) {
        await expect(caller.moveTask({ id: target.data.id, taskId })).rejects.toMatchObject({
          code: 'PRECONDITION_FAILED',
          message: 'Moving tasks between projects is temporarily disabled',
        });
        // Includes identifiers, hierarchy, timestamps, and every other stored column.
        expect(await readTree()).toEqual(before);
      }
      expect((await caller.detail({ id: target.data.id })).data.tasks).toEqual([]);
    },
  );

  it('requires a valid project identifier', async () => {
    await expect(caller.create({ identifier: 'not-valid!', name: 'Invalid' })).rejects.toThrow(
      'Invalid project identifier',
    );
  });

  it.each(['team/launch', 'roadmap?draft', '#plan', 'two--hyphens'])(
    'rejects the route-unsafe slug %s when creating a project',
    async (slug) => {
      await expect(
        caller.create({ identifier: 'VALID', name: 'Invalid slug', slug }),
      ).rejects.toThrow('Invalid project slug');
    },
  );

  it.each(['team/launch', 'roadmap?draft', '#plan', 'two--hyphens'])(
    'rejects the route-unsafe slug %s when updating a project',
    async (slug) => {
      const project = await caller.create({
        identifier: 'VALID',
        name: 'Valid project',
        slug: 'valid-project',
      });

      await expect(caller.update({ id: project.data.id, slug })).rejects.toThrow(
        'Invalid project slug',
      );
    },
  );

  it('accepts underscores in project slugs', async () => {
    const project = await caller.create({
      identifier: 'VALID',
      name: 'Valid project',
      slug: 'team_launch',
    });
    expect(project.data.slug).toBe('team_launch');

    const updated = await caller.update({ id: project.data.id, slug: 'team_launch_v2' });
    expect(updated.data.slug).toBe('team_launch_v2');
  });
});
