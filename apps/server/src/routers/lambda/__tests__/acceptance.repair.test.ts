// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  acceptanceComments,
  acceptances,
  agentOperations,
  agents,
  projects,
  tasks,
  topics,
  verifyRuns,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectReviewService } from '@/server/services/projectReview';

import * as agentGuard from '../_helpers/workspaceAgentGuard';
import { acceptanceRouter } from '../acceptance';
import { cleanupTestUser, createTestContext, createTestUser } from './integration/setup';

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => serverDB }));
const execAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent };
  }),
}));

describe('acceptance repair handoff', () => {
  let userId: string;
  let outsiderId: string;
  let acceptanceId: string;
  let projectId: string;
  let agentId: string;
  let commentId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = await createTestUser(serverDB);
    outsiderId = await createTestUser(serverDB);
    const [agent] = await serverDB
      .insert(agents)
      .values({ userId, title: 'Project Agent' })
      .returning();
    agentId = agent.id;
    const [project] = await serverDB
      .insert(projects)
      .values({ userId, name: 'Website', coordinatorAgentId: agentId })
      .returning();
    projectId = project.id;
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({
        projectId,
        subjectId: randomUUID(),
        subjectType: 'site',
        userId,
      })
      .returning();
    acceptanceId = acceptance.id;
    const [comment] = await serverDB
      .insert(acceptanceComments)
      .values({
        acceptanceId,
        authorUserId: userId,
        clientId: randomUUID(),
        content: 'Fix the unreadable menu',
        source: { url: 'https://website.example/menu' },
      })
      .returning();
    commentId = comment.id;
    execAgent.mockImplementation(async () => {
      const [topic] = await serverDB
        .insert(topics)
        .values({ userId, agentId, projectId })
        .returning();
      const operationId = randomUUID();
      await serverDB
        .insert(agentOperations)
        .values({ id: operationId, userId, agentId, topicId: topic.id, status: 'running' });
      return { operationId, success: true, topicId: topic.id };
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    execAgent.mockReset();
    await cleanupTestUser(serverDB, outsiderId);
    await cleanupTestUser(serverDB, userId);
  });

  it('creates and runs a project Agent Task with a durable source and feedback scope', async () => {
    const result = await acceptanceRouter.createCaller(createTestContext(userId)).requestRepair({
      id: acceptanceId,
      comment: 'Please fix these issues',
    });
    expect(result.dispatched).toBe(true);
    const [task] = await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId));
    expect(task.assigneeAgentId).toBe(agentId);
    expect(task.status).toBe('running');
    expect(task.instruction).toContain(acceptanceId);
    expect(task.instruction).toContain(commentId);
    expect(task.instruction).toContain('Fix the unreadable menu');
    const stored = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, acceptanceId),
    });
    expect(stored?.metadata?.repair).toMatchObject({ taskId: task.id, agentId, state: 'running' });
    expect(stored?.metadata?.repair?.commentIds).toEqual([commentId]);
    expect(stored?.subjectType).toBe('site');
    const original = await serverDB.query.acceptanceComments.findFirst({
      where: eq(acceptanceComments.id, commentId),
    });
    expect(original?.resolvedAt).toBeNull();
  });

  it('deduplicates concurrent requests and does not sweep in feedback posted during execution', async () => {
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    const results = await Promise.all([
      caller.requestRepair({ id: acceptanceId }),
      caller.requestRepair({ id: acceptanceId }),
    ]);
    expect(execAgent).toHaveBeenCalledTimes(1);
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId))).toHaveLength(
      1,
    );
    expect(results.some((result) => result.dispatched)).toBe(true);
    const [later] = await serverDB
      .insert(acceptanceComments)
      .values({
        acceptanceId,
        authorUserId: userId,
        clientId: randomUUID(),
        content: 'Later feedback',
      })
      .returning();
    await caller.requestRepair({ id: acceptanceId });
    const stored = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, acceptanceId),
    });
    expect(stored?.metadata?.repair?.commentIds).not.toContain(later.id);
    expect(execAgent).toHaveBeenCalledTimes(1);
  });

  it('reuses the Task when dispatch fails and the reviewer retries', async () => {
    const start = execAgent.getMockImplementation()!;
    execAgent.mockRejectedValueOnce(new Error('device offline'));
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    const failed = await caller.requestRepair({ id: acceptanceId });
    expect(failed).toMatchObject({ dispatched: false, reason: 'failed' });
    const [failedTask] = await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId));
    execAgent.mockImplementation(start);
    const retried = await caller.requestRepair({ id: acceptanceId });
    expect(retried).toMatchObject({ dispatched: true, taskId: failedTask.id });
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId))).toHaveLength(
      1,
    );
  });

  it('continues the original conversation instead of creating a Task when the source is known', async () => {
    await serverDB
      .update(acceptances)
      .set({ subjectType: 'standalone', status: 'delivered' })
      .where(eq(acceptances.id, acceptanceId));
    const [topic] = await serverDB
      .insert(topics)
      .values({ userId, agentId, projectId })
      .returning();
    await serverDB.insert(verifyRuns).values({
      acceptanceId,
      userId,
      roundIndex: 1,
      status: 'passed',
      metadata: { origin: { agentId, topicId: topic.id } },
    });
    const result = await acceptanceRouter
      .createCaller(createTestContext(userId))
      .requestRepair({ id: acceptanceId });
    expect(result).toMatchObject({ dispatched: true, topicId: topic.id, agentId });
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId))).toHaveLength(
      0,
    );
  });

  it('does not let an outsider use a Site to start its project Agent', async () => {
    const caller = acceptanceRouter.createCaller(createTestContext(outsiderId));
    await expect(caller.requestRepair({ id: acceptanceId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(execAgent).not.toHaveBeenCalled();
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId))).toHaveLength(
      0,
    );
  });

  it('applies current project roles and revokes repair access immediately', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'Team', slug: `repair-${userId}`, primaryOwnerId: userId })
      .returning();
    await serverDB.insert(workspaceMembers).values([
      { userId, workspaceId: workspace.id, role: 'owner' },
      { userId: outsiderId, workspaceId: workspace.id, role: 'member' },
    ]);
    await serverDB
      .update(projects)
      .set({ workspaceId: workspace.id })
      .where(eq(projects.id, projectId));
    await serverDB
      .update(acceptances)
      .set({ workspaceId: workspace.id })
      .where(eq(acceptances.id, acceptanceId));
    const reviewer = acceptanceRouter.createCaller(createTestContext(outsiderId));
    expect((await reviewer.getBundle({ id: acceptanceId })).canRequestRepair).toBe(true);
    await new ProjectReviewService(serverDB, userId).setMemberRole(projectId, outsiderId, 'viewer');
    expect((await reviewer.getBundle({ id: acceptanceId })).canRequestRepair).toBe(false);
    await expect(reviewer.requestRepair({ id: acceptanceId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await serverDB.delete(workspaceMembers).where(eq(workspaceMembers.userId, outsiderId));
    await expect(reviewer.requestRepair({ id: acceptanceId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(execAgent).not.toHaveBeenCalled();
  });

  it('does not bypass the project Agent use permission when creating a Task', async () => {
    vi.spyOn(agentGuard, 'assertCanUseWorkspaceAgent').mockRejectedValue(
      new TRPCError({ code: 'FORBIDDEN' }),
    );
    const result = await acceptanceRouter
      .createCaller(createTestContext(userId))
      .requestRepair({ id: acceptanceId });
    expect(result).toMatchObject({ dispatched: false, reason: 'forbidden' });
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId))).toHaveLength(
      0,
    );
    expect(execAgent).not.toHaveBeenCalled();
  });

  it('shows the Task delivery on the source review without exposing raw dispatch metadata', async () => {
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    const result = await caller.requestRepair({ id: acceptanceId });
    if (!result.dispatched) throw new Error('Repair did not start');
    await serverDB
      .update(agentOperations)
      .set({ status: 'done' })
      .where(eq(agentOperations.id, result.operationId));
    const bundle = await caller.getBundle({ id: acceptanceId });
    expect(bundle.repair).toMatchObject({ taskId: result.taskId, state: 'finished' });
    expect(bundle.repair?.deliveryAcceptanceId).toBeTruthy();
    expect(bundle.acceptance.metadata?.repair).toBeUndefined();
    expect(bundle.canReview).toBe(false);
    expect(bundle.canReject).toBe(false);
  });
});
