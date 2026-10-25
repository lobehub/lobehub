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

import type * as AcceptanceModelModule from '@/database/models/acceptance';
import { ProjectReviewService } from '@/server/services/projectReview';

import * as agentGuard from '../_helpers/workspaceAgentGuard';
import { acceptanceRouter } from '../acceptance';
import { taskRouter } from '../task';
import { cleanupTestUser, createTestContext, createTestUser } from './integration/setup';

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => serverDB }));
const execAgent = vi.fn();
const faults = vi.hoisted(() => ({
  failRunningPatch: false,
  failSubjectRead: false,
  failAfterStart: false,
}));
vi.mock('@/database/models/acceptance', async (importOriginal) => {
  const actual = await importOriginal<typeof AcceptanceModelModule>();
  class AcceptanceModel extends actual.AcceptanceModel {
    constructor(...args: ConstructorParameters<typeof actual.AcceptanceModel>) {
      super(...args);
      const patch = this.patchRepair;
      this.patchRepair = async (id, requestId, value) => {
        if (faults.failRunningPatch && value.state === 'running') {
          faults.failRunningPatch = false;
          throw new Error('progress write unavailable');
        }
        return patch(id, requestId, value);
      };
      const find = this.findBySubject;
      this.findBySubject = async (type, id) => {
        if (type === 'task' && faults.failSubjectRead) {
          faults.failSubjectRead = false;
          throw new Error('delivery read unavailable');
        }
        return find(type, id);
      };
    }
  }
  return { ...actual, AcceptanceModel };
});
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
        status: 'delivered',
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
    execAgent.mockImplementation(async (params) => {
      const topic = params.appContext?.topicId
        ? await serverDB.query.topics.findFirst({ where: eq(topics.id, params.appContext.topicId) })
        : (await serverDB.insert(topics).values({ userId, agentId, projectId }).returning())[0];
      const operationId = randomUUID();
      await serverDB
        .insert(agentOperations)
        .values({ id: operationId, userId, agentId, topicId: topic!.id, status: 'running' });
      await params.onOperationCreated?.(operationId);
      if (faults.failAfterStart) faults.failRunningPatch = true;
      return { operationId, success: true, topicId: topic!.id };
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    execAgent.mockReset();
    faults.failRunningPatch = false;
    faults.failSubjectRead = false;
    faults.failAfterStart = false;
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

  it.each(['site', 'origin'])(
    'retires a failed %s enqueue before allowing recovery or retry',
    async (source) => {
      if (source === 'origin') {
        await serverDB
          .update(acceptances)
          .set({ subjectType: 'standalone', status: 'delivered' })
          .where(eq(acceptances.id, acceptanceId));
        const [topic] = await serverDB.insert(topics).values({ userId, agentId }).returning();
        await serverDB.insert(verifyRuns).values({
          acceptanceId,
          userId,
          roundIndex: 1,
          status: 'passed',
          metadata: { origin: { agentId, topicId: topic.id } },
        });
      }
      const start = execAgent.getMockImplementation()!;
      let failedOperationId: string;
      execAgent.mockImplementationOnce(async (params) => {
        const result = await start(params);
        failedOperationId = result.operationId;
        throw new Error('Queue enqueue failed after persistence');
      });
      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      expect(
        await caller.requestRepair({ id: acceptanceId, comment: 'Frozen scope' }),
      ).toMatchObject({ dispatched: false, reason: 'failed' });
      const failed = await serverDB.query.agentOperations.findFirst({
        where: eq(agentOperations.id, failedOperationId!),
      });
      expect(failed?.status).toBe('error');
      expect(await caller.requestRepair({ id: acceptanceId })).toMatchObject({ dispatched: true });
      const stale = await serverDB.query.agentOperations.findFirst({
        where: eq(agentOperations.id, failedOperationId!),
      });
      expect(stale?.status).toBe('error');
    },
  );

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

  it.each(['startup', 'runtime'])(
    'retries an original-topic %s failure without a second decision',
    async (failure) => {
      await serverDB
        .update(acceptances)
        .set({ subjectType: 'standalone', status: 'delivered' })
        .where(eq(acceptances.id, acceptanceId));
      const [topic] = await serverDB.insert(topics).values({ userId, agentId }).returning();
      const [round] = await serverDB
        .insert(verifyRuns)
        .values({
          acceptanceId,
          userId,
          roundIndex: 1,
          status: 'passed',
          metadata: { origin: { agentId, topicId: topic.id } },
        })
        .returning();
      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      if (failure === 'startup') execAgent.mockRejectedValueOnce(new Error('offline'));
      const first = await caller.requestRepair({
        id: acceptanceId,
        comment: 'Frozen requirements',
      });
      if (failure === 'runtime') {
        if (!first.dispatched) throw new Error('Expected a running operation');
        await serverDB
          .update(agentOperations)
          .set({ status: 'error', error: { message: 'offline' } })
          .where(eq(agentOperations.id, first.operationId));
      }
      const decided = await serverDB.query.verifyRuns.findFirst({
        where: eq(verifyRuns.id, round.id),
      });
      const retried = await caller.requestRepair({
        id: acceptanceId,
        comment: 'New instructions excluded',
      });
      expect(retried).toMatchObject({ dispatched: true, topicId: topic.id });
      expect(execAgent).toHaveBeenCalledTimes(2);
      expect(execAgent.mock.lastCall![0].prompt).toContain('Frozen requirements');
      expect(execAgent.mock.lastCall![0].prompt).not.toContain('New instructions excluded');
      const after = await serverDB.query.verifyRuns.findFirst({
        where: eq(verifyRuns.id, round.id),
      });
      expect(after?.decisionDetail).toEqual(decided?.decisionDetail);
    },
  );

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

  it('keeps frozen repair context out of list and subject payloads', async () => {
    await serverDB
      .update(acceptances)
      .set({ subjectType: 'standalone', status: 'delivered' })
      .where(eq(acceptances.id, acceptanceId));
    await serverDB
      .insert(verifyRuns)
      .values({ acceptanceId, userId, roundIndex: 1, status: 'passed' });
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    await caller.requestRepair({ id: acceptanceId });
    const list = await caller.list({});
    expect(list.find((item) => item.id === acceptanceId)?.metadata?.repair).toBeUndefined();
    const stored = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, acceptanceId),
    });
    const subject = await caller.getBySubject({
      subjectId: stored!.subjectId,
      subjectType: 'standalone',
    });
    expect(subject?.metadata?.repair).toBeUndefined();
    expect(stored?.metadata?.repair?.feedback).toContain('Fix the unreadable menu');
  });

  it('does not extend an acceptance collaboration grant into project Task execution', async () => {
    await serverDB
      .update(acceptances)
      .set({ subjectType: 'standalone', status: 'delivered', visibility: 'public' })
      .where(eq(acceptances.id, acceptanceId));
    await serverDB
      .insert(verifyRuns)
      .values({ acceptanceId, userId, roundIndex: 1, status: 'passed' });
    await serverDB.insert(acceptanceComments).values({
      acceptanceId,
      authorUserId: outsiderId,
      clientId: randomUUID(),
      content: 'Can help with this delivery',
      kind: 'access_request',
      metadata: {
        accessRequest: { permission: 'collaborate', status: 'granted', decidedByUserId: userId },
      },
    });
    const result = await acceptanceRouter
      .createCaller(createTestContext(outsiderId))
      .requestRepair({ id: acceptanceId });
    expect(result.dispatched).toBe(false);
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId))).toHaveLength(
      0,
    );
    expect(execAgent).not.toHaveBeenCalled();
  });

  it('keeps a personal project repair delivery private from its first creation', async () => {
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    const result = await caller.requestRepair({ id: acceptanceId });
    expect(result.dispatched).toBe(true);
    const source = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, acceptanceId),
    });
    const deliveryId = source!.metadata!.repair!.deliveryAcceptanceId!;
    const delivery = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, deliveryId),
    });
    expect(delivery?.visibility).toBe('private');
    await expect(
      acceptanceRouter.createCaller(createTestContext('')).getBundle({ id: deliveryId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['site', 'standalone'] as const)(
    'recovers a %s run when the final progress write fails after dispatch',
    async (subjectType) => {
      if (subjectType === 'standalone') {
        const [topic] = await serverDB.insert(topics).values({ userId, agentId }).returning();
        await serverDB
          .update(acceptances)
          .set({ subjectType })
          .where(eq(acceptances.id, acceptanceId));
        await serverDB.insert(verifyRuns).values({
          acceptanceId,
          userId,
          roundIndex: 1,
          status: 'passed',
          metadata: { origin: { topicId: topic.id, agentId } },
        });
      }
      faults.failAfterStart = true;
      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.requestRepair({ id: acceptanceId });
      if (!result.dispatched) throw new Error('Expected a live run');
      faults.failAfterStart = false;
      await serverDB
        .update(agentOperations)
        .set({ status: 'done' })
        .where(eq(agentOperations.id, result.operationId));
      const bundle = await caller.getBundle({ id: acceptanceId });
      expect(bundle.repair?.state).toBe('finished');
      expect(execAgent).toHaveBeenCalledTimes(1);
    },
  );

  it('reuses the created Task when the following delivery lookup fails', async () => {
    const original = taskRouter.createCaller;
    vi.spyOn(taskRouter, 'createCaller').mockImplementation((...args) => {
      const caller = original(...args);
      return new Proxy(caller, {
        get(target, key) {
          if (key !== 'create') return Reflect.get(target, key);
          return async (...input: Parameters<typeof caller.create>) => {
            const result = await caller.create(...input);
            faults.failSubjectRead = true;
            return result;
          };
        },
      });
    });
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    expect(await caller.requestRepair({ id: acceptanceId })).toMatchObject({
      dispatched: false,
      reason: 'failed',
    });
    expect(faults.failSubjectRead).toBe(false);
    vi.restoreAllMocks();
    expect(await caller.requestRepair({ id: acceptanceId })).toMatchObject({ dispatched: true });
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId))).toHaveLength(
      1,
    );
  });

  it('returns the frozen requirements for retry while leaving later feedback out', async () => {
    execAgent.mockRejectedValueOnce(new Error('offline'));
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    await caller.requestRepair({ id: acceptanceId, comment: 'Original instructions' });
    await serverDB.insert(acceptanceComments).values({
      acceptanceId,
      authorUserId: userId,
      clientId: randomUUID(),
      content: 'Later request',
    });
    const bundle = await caller.getBundle({ id: acceptanceId });
    expect(bundle.repair?.comment).toBe('Original instructions');
    expect(bundle.repair?.commentIds).toEqual([commentId]);
  });

  it('falls back to the project when the original topic was deleted', async () => {
    await serverDB
      .update(acceptances)
      .set({ subjectType: 'standalone' })
      .where(eq(acceptances.id, acceptanceId));
    await serverDB.insert(verifyRuns).values({
      acceptanceId,
      userId,
      roundIndex: 1,
      status: 'passed',
      metadata: { origin: { topicId: 'tpc_deleted', agentId } },
    });
    const result = await acceptanceRouter
      .createCaller(createTestContext(userId))
      .requestRepair({ id: acceptanceId });
    expect(result).toMatchObject({ dispatched: true });
    if (result.dispatched) expect(result.taskId).toBeTruthy();
  });

  it('shows the persisted runtime error rather than a generic terminal marker', async () => {
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    const result = await caller.requestRepair({ id: acceptanceId });
    if (!result.dispatched) throw new Error('Expected a live run');
    await serverDB
      .update(agentOperations)
      .set({
        status: 'error',
        error: { message: 'Execution device is offline', type: 'DeviceOffline' },
      })
      .where(eq(agentOperations.id, result.operationId));
    const bundle = await caller.getBundle({ id: acceptanceId });
    expect(bundle.repair).toMatchObject({ state: 'failed', error: 'Execution device is offline' });
  });
});
