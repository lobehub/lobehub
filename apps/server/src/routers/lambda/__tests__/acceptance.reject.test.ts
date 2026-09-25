// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { acceptances, agents, topics, verifyRuns } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RbacPermissionModule from '@/business/server/trpc-middlewares/rbacPermission';
import type * as AcceptanceModelModule from '@/database/models/acceptance';
import type * as GoalModelModule from '@/database/models/goal';

import { acceptanceRouter } from '../acceptance';
import { cleanupTestUser, createTestContext, createTestUser } from './integration/setup';

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => serverDB }));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn() },
}));
const mockExecAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: mockExecAgent };
  }),
}));

const flags = vi.hoisted(() => ({
  denyMessageCreate: false,
  failRepairingStamp: false,
  goalOwnsTask: false,
}));
// OSS stubs the RBAC gate; stand in for Cloud's `message:create` check.
vi.mock('@/business/server/trpc-middlewares/rbacPermission', async (importOriginal) => {
  const actual = await importOriginal<typeof RbacPermissionModule>();
  const { trpc } = await import('@/libs/trpc/lambda/init');
  const { TRPCError } = await import('@trpc/server');
  return {
    ...actual,
    withScopedPermission: (action: string) =>
      trpc.middleware(async (opts) => {
        if (action === 'message:create' && flags.denyMessageCreate) {
          throw new TRPCError({ code: 'FORBIDDEN' });
        }
        return opts.next();
      }),
  };
});
vi.mock('@/database/models/goal', async (importOriginal) => {
  const actual = await importOriginal<typeof GoalModelModule>();
  class GoalModel extends actual.GoalModel {
    constructor(...args: ConstructorParameters<typeof actual.GoalModel>) {
      super(...args);
      const original = this.findByGraphTask;
      this.findByGraphTask = async (taskId) =>
        flags.goalOwnsTask ? ({ id: 'goal_1' } as any) : original(taskId);
    }
  }
  return { ...actual, GoalModel };
});
vi.mock('@/database/models/acceptance', async (importOriginal) => {
  const actual = await importOriginal<typeof AcceptanceModelModule>();
  class AcceptanceModel extends actual.AcceptanceModel {
    constructor(...args: ConstructorParameters<typeof actual.AcceptanceModel>) {
      super(...args);
      const original = this.updateStatus;
      this.updateStatus = async (id, status) => {
        if (flags.failRepairingStamp && status === 'repairing') throw new Error('db down');
        return original(id, status);
      };
    }
  }
  return { ...actual, AcceptanceModel };
});

describe('acceptanceRouter reject', () => {
  let userId: string;
  let strangerId: string;
  let acceptanceId: string;
  let runId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = await createTestUser(serverDB);
    strangerId = await createTestUser(serverDB);
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({
        status: 'delivered',
        subjectId: randomUUID(),
        subjectType: 'standalone',
        userId,
      })
      .returning();
    acceptanceId = acceptance.id;
    const [run] = await serverDB
      .insert(verifyRuns)
      .values({
        acceptanceId,
        roundIndex: 1,
        status: 'passed',
        userId,
      })
      .returning();
    runId = run.id;
  });

  afterEach(async () => {
    mockExecAgent.mockReset();
    flags.denyMessageCreate = false;
    flags.failRepairingStamp = false;
    flags.goalOwnsTask = false;
    await cleanupTestUser(serverDB, strangerId);
    await cleanupTestUser(serverDB, userId);
  });

  const seedOrigin = async (origin: { agentId?: string; topicId: string }) => {
    await serverDB.update(verifyRuns).set({ metadata: { origin } }).where(eq(verifyRuns.id, runId));
  };

  const seedTopic = async () => {
    const [agent] = await serverDB
      .insert(agents)
      .values({ title: 'Delivery Bot', userId })
      .returning();
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: agent.id, title: 'Delivery', userId })
      .returning();
    return { agentId: agent.id, topicId: topic.id };
  };

  describe('repair dispatch', () => {
    it('sends the delivery back to the authoring agent and marks it repairing', async () => {
      const { agentId, topicId } = await seedTopic();
      // The origin may omit the agent — the topic's own agent is used.
      await seedOrigin({ topicId });
      mockExecAgent.mockResolvedValue({ operationId: 'op_repair' });

      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.reject({ comment: 'Tab title missing', id: acceptanceId });

      expect(result.repairDispatch).toEqual({
        agentId,
        dispatched: true,
        operationId: 'op_repair',
        topicId,
      });
      expect(result.status).toBe('repairing');
      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId,
          appContext: { topicId },
          prompt: expect.stringContaining(`lh acceptance feedback ${acceptanceId} --actionable`),
        }),
      );
      const [run] = await serverDB.select().from(verifyRuns).where(eq(verifyRuns.id, runId));
      expect(run.decisionDetail?.comment).toBe('Tab title missing');
    });

    it('only records the reject when the rounds name no authoring conversation', async () => {
      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.reject({ id: acceptanceId });

      expect(result.repairDispatch).toEqual({ dispatched: false, reason: 'no_origin' });
      expect(result.status).toBe('rejected');
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('does not dispatch when the caller opts out', async () => {
      const { topicId } = await seedTopic();
      await seedOrigin({ topicId });

      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.reject({ dispatch: false, id: acceptanceId });

      expect(result.repairDispatch).toEqual({ dispatched: false, reason: 'skipped' });
      expect(result.status).toBe('rejected');
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('keeps the reject when the origin topic no longer exists', async () => {
      await seedOrigin({ topicId: 'tpc_gone' });

      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.reject({ id: acceptanceId });

      expect(result.repairDispatch).toEqual({ dispatched: false, reason: 'origin_unavailable' });
      expect(result.status).toBe('rejected');
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('does not start the agent for a caller without conversation-write permission', async () => {
      const { topicId } = await seedTopic();
      await seedOrigin({ topicId });
      flags.denyMessageCreate = true;

      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.reject({ id: acceptanceId });

      expect(result.repairDispatch).toEqual({ dispatched: false, reason: 'forbidden' });
      expect(result.status).toBe('rejected');
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('leaves a Goal Task to its coordinator', async () => {
      const { topicId } = await seedTopic();
      await seedOrigin({ topicId });
      await serverDB
        .update(acceptances)
        .set({ subjectId: 'task_goal', subjectType: 'task' })
        .where(eq(acceptances.id, acceptanceId));
      flags.goalOwnsTask = true;

      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.reject({ id: acceptanceId });

      expect(result.repairDispatch).toEqual({ dispatched: false, reason: 'goal_coordinator' });
      expect(result.status).toBe('rejected');
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('still reports the dispatch when the repairing stamp fails after the run started', async () => {
      const { agentId, topicId } = await seedTopic();
      await seedOrigin({ topicId });
      mockExecAgent.mockResolvedValue({ operationId: 'op_repair' });
      flags.failRepairingStamp = true;

      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.reject({ id: acceptanceId });

      expect(result.repairDispatch).toEqual({
        agentId,
        dispatched: true,
        operationId: 'op_repair',
        topicId,
      });
      expect(mockExecAgent).toHaveBeenCalledTimes(1);
    });

    it('reports a failed agent start without undoing the reject', async () => {
      const { topicId } = await seedTopic();
      await seedOrigin({ topicId });
      mockExecAgent.mockRejectedValue(new Error('device offline'));

      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.reject({ id: acceptanceId });

      expect(result.repairDispatch).toEqual({
        dispatched: false,
        error: 'Failed to trigger agent: device offline',
        reason: 'failed',
      });
      expect(result.status).toBe('rejected');
    });
  });

  it.each([undefined, '', '   ', '  Add dark mode evidence  '])(
    'returns the delivery and records the optional reason (%j)',
    async (comment) => {
      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.reject({ comment, id: acceptanceId });
      expect(result.status).toBe('rejected');
      const [run] = await serverDB.select().from(verifyRuns).where(eq(verifyRuns.id, runId));
      expect(run.userDecision).toBe('reject');
      expect(run.decisionDetail?.comment).toBe(comment?.trim() || undefined);
      expect(run.decisionDetail?.decidedBy).toBe(userId);
    },
  );

  it('still rejects reasons over the length limit', async () => {
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    await expect(
      caller.reject({ comment: 'x'.repeat(2001), id: acceptanceId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('does not let another user return a private delivery without a reason', async () => {
    const caller = acceptanceRouter.createCaller(createTestContext(strangerId));
    await expect(caller.reject({ id: acceptanceId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [acceptance] = await serverDB
      .select()
      .from(acceptances)
      .where(eq(acceptances.id, acceptanceId));
    expect(acceptance.status).toBe('delivered');
  });
});
