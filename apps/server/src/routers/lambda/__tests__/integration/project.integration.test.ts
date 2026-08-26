// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, knowledgeBases, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectRouter } from '../../project';
import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));

const mockInterruptTask = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(() => ({ interruptTask: mockInterruptTask })),
}));

// `after()` schedules its callback fire-and-forget in production. Tests run
// it eagerly (and await it below) so the interrupt side effect is
// observable without racing the assertion — same pattern as
// `lambda/__tests__/agent.test.ts`.
const afterTasks: Promise<unknown>[] = [];
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => Promise<unknown> | unknown) => {
    afterTasks.push(Promise.resolve(work()));
  },
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
    mockInterruptTask.mockClear();
    afterTasks.length = 0;
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

  // Regression for LOBE-11930 / codex P1: `project.delete` cascades away
  // the coordinator agent (a personal, `virtual: true` agent that can carry
  // its own Agent Share — see `ProjectModel`'s own test suite), and used to
  // do so without checking for an in-flight visitor run. This exercises the
  // full router wiring: `interruptSnapshottedShareRuns` reaching
  // `ProjectModel.delete` reaching the coordinator's `AgentModel.delete`.
  it('interrupts an in-flight visitor run on the coordinator agent when the project is deleted', async () => {
    const created = await caller.create({ identifier: 'apolo2', name: 'Apollo 2' });
    await serverDB.insert(topics).values({
      id: `visitor-topic-${created.data.id}`,
      title: 'Visitor',
      userId,
      agentId: created.data.coordinatorAgentId,
      senderId: 'visitor-1',
      metadata: { runningOperation: { assistantMessageId: 'msg-1', operationId: 'op-1' } },
    });

    await caller.delete({ id: created.data.id });
    await Promise.all(afterTasks);

    expect(mockInterruptTask).toHaveBeenCalledWith({ operationId: 'op-1' });
  });

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
