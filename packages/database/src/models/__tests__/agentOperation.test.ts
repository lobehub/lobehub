// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { matchesAgentInterventionContinuationProvenance } from '@/business/server/agent-run/agentInterventionIdentity';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-operation-test-user-id';
const otherUserId = 'agent-operation-test-other-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('AgentOperationModel', () => {
  describe('recordStart', () => {
    it('inserts a row with status=running and the provided ids', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-start-1';

      await model.recordStart({
        appContext: { scope: 'chat', sourceMessageId: 'msg-1' },
        maxSteps: 20,
        model: 'gpt-4o',
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        provider: 'openai',
        trigger: 'chat',
      });

      const row = await model.findById(operationId);
      expect(row).toMatchObject({
        appContext: { scope: 'chat', sourceMessageId: 'msg-1' },
        id: operationId,
        maxSteps: 20,
        model: 'gpt-4o',
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        provider: 'openai',
        status: 'running',
        trigger: 'chat',
        userId,
      });
      expect(row?.startedAt).toBeInstanceOf(Date);
      expect(row?.completedAt).toBeNull();
    });

    it('persists the agent-signal marker into metadata so server tools can read it back', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-start-marker';
      // Server-side self-iteration tools resolve the review window / source id from
      // metadata.agentSignal (the trimmed appContext intentionally drops it). If
      // the marker is not persisted here, tools fall back to a 1970 window +
      // operationId source.
      const agentSignal = {
        agentId: 'agent_reviewed',
        kind: 'nightly-review',
        localDate: '2026-05-30',
        reviewWindowEnd: '2026-05-30T00:00:00.000Z',
        reviewWindowStart: '2026-05-29T00:00:00.000Z',
        sourceId: 'nightly-review:user:agent_reviewed:2026-05-30',
      };

      await model.recordStart({
        appContext: { scope: 'chat' },
        metadata: { agentSignal },
        operationId,
      });

      const row = await model.findById(operationId);
      expect(row?.metadata).toEqual({ agentSignal });
    });

    it('is idempotent on the primary key', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-start-2';

      await model.recordStart({ operationId });
      // Second call must not throw — primary-key conflict is swallowed.
      await model.recordStart({ operationId });

      const rows = await serverDB
        .select()
        .from(agentOperations)
        .where(eq(agentOperations.id, operationId));
      expect(rows).toHaveLength(1);
    });
  });

  describe('agent intervention dispatch recovery markers', () => {
    it('persists ready preparation and queue ACK without replacing provenance', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-intervention-marker';
      const provenance = {
        resolutionRequestId: 'request-intervention-marker',
        sourceOperationId: 'source-operation',
        sourceToolMessageIds: ['tool-message'],
      };
      await model.recordStart({
        metadata: { agentInterventionContinuation: provenance },
        operationId,
      });

      await expect(
        model.recordAgentInterventionPreparation(operationId, {
          deduplicationId: 'agent-intervention:op-intervention-marker:0',
          resolutionRequestId: provenance.resolutionRequestId,
          state: 'ready',
          stepIndex: 0,
        }),
      ).resolves.toBe(true);
      await expect(
        model.recordAgentInterventionDispatch(operationId, {
          deduplicationId: 'agent-intervention:op-intervention-marker:0',
          messageId: 'queue-message',
          resolutionRequestId: provenance.resolutionRequestId,
          scheduledAt: '2026-08-26T00:00:00.000Z',
          state: 'scheduled',
        }),
      ).resolves.toBe(true);

      const row = await model.findById(operationId);
      expect(
        matchesAgentInterventionContinuationProvenance(
          row?.metadata?.agentInterventionContinuation,
          provenance,
        ),
      ).toBe(true);
      expect(row?.metadata).toMatchObject({
        agentInterventionContinuation: provenance,
        agentInterventionDispatch: {
          deduplicationId: 'agent-intervention:op-intervention-marker:0',
          state: 'scheduled',
        },
        agentInterventionPreparation: {
          deduplicationId: 'agent-intervention:op-intervention-marker:0',
          state: 'ready',
          stepIndex: 0,
        },
      });
    });

    it('rejects a preparation marker from another request or owner', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const attacker = new AgentOperationModel(serverDB, otherUserId);
      const operationId = 'op-intervention-marker-authority';
      await model.recordStart({
        metadata: {
          agentInterventionContinuation: {
            resolutionRequestId: 'request-owner',
            sourceOperationId: 'source-operation',
            sourceToolMessageIds: ['tool-message'],
          },
        },
        operationId,
      });
      const marker = {
        deduplicationId: 'agent-intervention:op-intervention-marker-authority:0',
        resolutionRequestId: 'request-other',
        state: 'ready' as const,
        stepIndex: 0,
      };

      await expect(model.recordAgentInterventionPreparation(operationId, marker)).resolves.toBe(
        false,
      );
      await expect(
        attacker.recordAgentInterventionPreparation(operationId, {
          ...marker,
          resolutionRequestId: 'request-owner',
        }),
      ).resolves.toBe(false);
      expect((await model.findById(operationId))?.metadata).not.toHaveProperty(
        'agentInterventionPreparation',
      );
    });
  });

  describe('recordCompletion', () => {
    it('updates the row to a terminal status with aggregates and trace key', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-complete-1';

      const completedAt = new Date('2026-05-13T01:23:45.000Z');
      await model.recordStart({ operationId });
      await model.recordCompletion(operationId, {
        completedAt,
        completionReason: 'done',
        cost: { total: 0.123 },
        llmCalls: 4,
        processingTimeMs: 5432,
        status: 'done',
        stepCount: 7,
        toolCalls: 2,
        totalCost: 0.123,
        totalInputTokens: 1000,
        totalOutputTokens: 200,
        totalTokens: 1200,
        traceS3Key: 'agent-traces/agent-x/topic-x/op-complete-1.json',
        usage: { llm: { apiCalls: 4 } },
      });

      const row = await model.findById(operationId);
      expect(row).toMatchObject({
        completionReason: 'done',
        cost: { total: 0.123 },
        llmCalls: 4,
        processingTimeMs: 5432,
        status: 'done',
        stepCount: 7,
        toolCalls: 2,
        totalCost: 0.123,
        totalInputTokens: 1000,
        totalOutputTokens: 200,
        totalTokens: 1200,
        traceS3Key: 'agent-traces/agent-x/topic-x/op-complete-1.json',
      });
      expect(row?.completedAt?.toISOString()).toBe(completedAt.toISOString());
    });

    it('leaves completedAt null when not explicitly provided (e.g. waiting_for_human)', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-waiting';

      await model.recordStart({ operationId });
      await model.recordCompletion(operationId, {
        completionReason: 'waiting_for_human',
        status: 'waiting_for_human',
      });

      const row = await model.findById(operationId);
      expect(row?.status).toBe('waiting_for_human');
      expect(row?.completedAt).toBeNull();
    });

    it('writes error and interruption payloads on failure paths', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-complete-error';

      await model.recordStart({ operationId });
      await model.recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason: 'error',
        error: { message: 'boom', type: 'AgentRuntimeError' },
        interruption: {
          canResume: false,
          interruptedAt: '2026-05-13T00:00:00.000Z',
          reason: 'rate_limited',
        },
        status: 'error',
      });

      const row = await model.findById(operationId);
      expect(row?.status).toBe('error');
      expect(row?.completionReason).toBe('error');
      expect(row?.error).toMatchObject({ message: 'boom', type: 'AgentRuntimeError' });
      expect(row?.interruption).toMatchObject({ canResume: false, reason: 'rate_limited' });
    });

    it('is a no-op when the start row was never written', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      // No prior recordStart — recordCompletion must not throw and must not
      // create a phantom row.
      await model.recordCompletion('op-missing', { status: 'done', completionReason: 'done' });

      const row = await model.findById('op-missing');
      expect(row).toBeNull();
    });

    it('does not flip another user’s row when their operationId is known', async () => {
      const ownerModel = new AgentOperationModel(serverDB, userId);
      const attackerModel = new AgentOperationModel(serverDB, otherUserId);
      const operationId = 'op-cross-user';

      await ownerModel.recordStart({ operationId });
      await attackerModel.recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason: 'error',
        error: { message: 'spoofed', type: 'AgentRuntimeError' },
        status: 'error',
      });

      // Owner's row must still read as running — the cross-user update is
      // filtered out by the userId scope in the WHERE clause.
      const row = await ownerModel.findById(operationId);
      expect(row?.status).toBe('running');
      expect(row?.error).toBeNull();
      // The attacker cannot read the row either.
      expect(await attackerModel.findById(operationId)).toBeNull();
    });
  });

  describe('operation lease', () => {
    it('refreshes a running operation and only settles an expired lease', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-lease';
      await model.recordStart({ operationId });
      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, operationId));

      await model.touchRunning(operationId);
      const refreshed = await model.findById(operationId);
      expect(refreshed!.updatedAt.getTime()).toBeGreaterThan(
        new Date('2026-01-01T00:00:00.000Z').getTime(),
      );

      expect(await model.settleStaleRunning(operationId, new Date(Date.now() - 60_000))).toBe(
        false,
      );
      expect((await model.findById(operationId))?.status).toBe('running');

      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, operationId));
      expect(await model.settleStaleRunning(operationId, new Date(Date.now() - 60_000))).toBe(true);
      expect(await model.findById(operationId)).toMatchObject({
        completionReason: 'lease_expired',
        status: 'abandoned',
      });
    });

    it('persists the latest cost while reclaiming an expired lease', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-lease-cost';
      await model.recordStart({ operationId });
      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, operationId));

      expect(await model.settleStaleRunning(operationId, new Date(Date.now() - 60_000), 0.75)).toBe(
        true,
      );
      expect(await model.findById(operationId)).toMatchObject({
        status: 'abandoned',
        totalCost: 0.75,
      });
    });

    it('does not let a late completion overwrite a reclaimed operation', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-reclaimed-completion-race';
      await model.recordStart({ operationId });
      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, operationId));

      expect(await model.settleStaleRunning(operationId, new Date(Date.now() - 60_000))).toBe(true);
      expect(
        await model.recordCompletion(operationId, {
          completionReason: 'done',
          status: 'done',
        }),
      ).toBe(false);
      expect(await model.findById(operationId)).toMatchObject({
        completionReason: 'lease_expired',
        status: 'abandoned',
      });
    });
  });

  describe('sumChildUsage', () => {
    const seedChild = async (
      model: AgentOperationModel,
      id: string,
      parentOperationId: string,
      usage: { llmCalls: number; toolCalls: number; totalCost: number; totalTokens: number },
    ) => {
      await model.recordStart({ operationId: id, parentOperationId });
      await model.recordCompletion(id, {
        completionReason: 'done',
        llmCalls: usage.llmCalls,
        status: 'done',
        toolCalls: usage.toolCalls,
        totalCost: usage.totalCost,
        totalInputTokens: usage.totalTokens,
        totalOutputTokens: 0,
        totalTokens: usage.totalTokens,
      });
    };

    it('sums every child of the parent', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      await model.recordStart({ operationId: 'parent' });
      await seedChild(model, 'child-a', 'parent', {
        llmCalls: 2,
        toolCalls: 3,
        totalCost: 0.25,
        totalTokens: 1000,
      });
      await seedChild(model, 'child-b', 'parent', {
        llmCalls: 1,
        toolCalls: 4,
        totalCost: 0.75,
        totalTokens: 2000,
      });

      const rollup = await model.sumChildUsage('parent');

      expect(rollup).toEqual({
        llmCalls: 3,
        toolCalls: 7,
        totalCost: 1,
        totalInputTokens: 3000,
        totalOutputTokens: 0,
        totalTokens: 3000,
      });
    });

    // The whole reason this is a read-time SUM: the sub-agent completion bridge is
    // contractually re-deliverable, so an accumulation onto the parent row would
    // double-count. Re-deriving is exact however many times it runs.
    it('is idempotent — re-deriving does not accumulate', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      await model.recordStart({ operationId: 'parent' });
      await seedChild(model, 'child-a', 'parent', {
        llmCalls: 1,
        toolCalls: 1,
        totalCost: 0.5,
        totalTokens: 1234,
      });

      const first = await model.sumChildUsage('parent');
      const second = await model.sumChildUsage('parent');

      expect(second).toEqual(first);
      expect(second.totalTokens).toBe(1234);
    });

    it('returns zeroes for an operation with no children', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      await model.recordStart({ operationId: 'lonely' });

      expect(await model.sumChildUsage('lonely')).toEqual({
        llmCalls: 0,
        toolCalls: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      });
    });

    it("does not sum another user's children", async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const attacker = new AgentOperationModel(serverDB, otherUserId);
      await model.recordStart({ operationId: 'parent' });
      await seedChild(model, 'child-a', 'parent', {
        llmCalls: 1,
        toolCalls: 1,
        totalCost: 0.5,
        totalTokens: 1000,
      });

      expect(await attacker.sumChildUsage('parent')).toEqual({
        llmCalls: 0,
        toolCalls: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe('getMaxDurationSeconds', () => {
    it('returns the longest wall-clock duration, ignoring in-flight and other users', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      await serverDB.insert(agentOperations).values([
        // 5 minutes
        {
          completedAt: new Date('2026-05-13T10:05:00.000Z'),
          id: 'op-dur-1',
          startedAt: new Date('2026-05-13T10:00:00.000Z'),
          status: 'done',
          userId,
        },
        // 1 hour — the longest
        {
          completedAt: new Date('2026-05-13T12:00:00.000Z'),
          id: 'op-dur-2',
          startedAt: new Date('2026-05-13T11:00:00.000Z'),
          status: 'done',
          userId,
        },
        // in-flight: no completedAt -> excluded
        {
          completedAt: null,
          id: 'op-dur-running',
          startedAt: new Date('2026-05-13T09:00:00.000Z'),
          status: 'running',
          userId,
        },
        // another user's much longer op -> excluded
        {
          completedAt: new Date('2026-05-13T20:00:00.000Z'),
          id: 'op-dur-other',
          startedAt: new Date('2026-05-13T10:00:00.000Z'),
          status: 'done',
          userId: otherUserId,
        },
      ]);

      const result = await model.getMaxDurationSeconds();
      expect(result).toBe(3600);
    });

    it('returns 0 when there are no completed operations', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      await serverDB.insert(agentOperations).values({
        completedAt: null,
        id: 'op-dur-none',
        startedAt: new Date('2026-05-13T09:00:00.000Z'),
        status: 'running',
        userId,
      });

      const result = await model.getMaxDurationSeconds();
      expect(result).toBe(0);
    });
  });

  describe('listOperationTree', () => {
    it('returns the root op together with its direct children, owner-scoped', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      await serverDB.insert(agentOperations).values([
        { id: 'root', status: 'done', userId },
        { id: 'child-a', parentOperationId: 'root', status: 'done', userId },
        { id: 'child-b', parentOperationId: 'root', status: 'done', userId },
        // Unrelated op (different parent) must not leak in.
        { id: 'stranger', parentOperationId: 'other-root', status: 'done', userId },
        // Another user's child of the same root must not leak in.
        { id: 'foreign-child', parentOperationId: 'root', status: 'done', userId: otherUserId },
      ]);

      const tree = await model.listOperationTree('root');
      expect(tree.map((op) => op.id).sort()).toEqual(['child-a', 'child-b', 'root']);
    });

    it('returns just the root when it has no children', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      await serverDB.insert(agentOperations).values({ id: 'lonely', status: 'done', userId });

      const tree = await model.listOperationTree('lonely');
      expect(tree.map((op) => op.id)).toEqual(['lonely']);
    });
  });

  describe('findOwnOperationById', () => {
    beforeEach(async () => {
      await serverDB.insert(topics).values([
        { id: 'own-tpc', userId },
        // Agent-share visitor topic: creator's userId + a visitor senderId.
        { id: 'own-tpc-visitor', senderId: 'visitor-user-x', userId },
      ]);
      await serverDB.insert(agentOperations).values([
        { id: 'op-own', status: 'done', topicId: 'own-tpc', userId },
        { id: 'op-own-visitor', status: 'done', topicId: 'own-tpc-visitor', userId },
        { id: 'op-own-topicless', status: 'done', userId },
      ]);
    });

    it('hides an operation recorded inside an agent-share visitor topic', async () => {
      // Visitor runs execute under the creator's identity, so the row passes
      // ownership — the creator-facing trace lookup must still read it as absent.
      const model = new AgentOperationModel(serverDB, userId);

      expect(await model.findOwnOperationById('op-own-visitor')).toBeNull();
      // The runtime lookup keeps working: it drives the visitor's own run.
      expect(await model.findById('op-own-visitor')).toMatchObject({ id: 'op-own-visitor' });
    });

    it('returns the creator own operations, topic-bound or not', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      expect(await model.findOwnOperationById('op-own')).toMatchObject({ id: 'op-own' });
      expect(await model.findOwnOperationById('op-own-topicless')).toMatchObject({
        id: 'op-own-topicless',
      });
    });

    it('does not cross the ownership boundary', async () => {
      const model = new AgentOperationModel(serverDB, otherUserId);

      expect(await model.findOwnOperationById('op-own')).toBeNull();
    });
  });

  describe('listByTopic', () => {
    beforeEach(async () => {
      await serverDB.insert(topics).values([
        { id: 'tpc-a', userId },
        { id: 'tpc-b', userId },
        { id: 'tpc-foreign', userId: otherUserId },
        // Agent-share visitor topic: creator's userId + a visitor senderId.
        { id: 'tpc-visitor', senderId: 'visitor-user-x', userId },
      ]);
    });

    it('excludes operations recorded inside an agent-share visitor topic', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      // Visitor runs execute under the creator's identity, so their operation
      // rows pass the ownership filter — the trace panel must still not expose
      // a visitor conversation's trajectory.
      await serverDB
        .insert(agentOperations)
        .values([{ id: 'op-visitor', status: 'done', topicId: 'tpc-visitor', userId }]);

      const rows = await model.listByTopic('tpc-visitor');
      expect(rows).toEqual([]);
    });

    it('returns the topic operations newest first, owner-scoped', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      await serverDB.insert(agentOperations).values([
        {
          createdAt: new Date('2026-01-01'),
          id: 'op-old',
          status: 'done',
          topicId: 'tpc-a',
          userId,
        },
        {
          createdAt: new Date('2026-01-03'),
          id: 'op-new',
          status: 'done',
          topicId: 'tpc-a',
          userId,
        },
        // Another topic's op must not leak in.
        { id: 'op-other-topic', status: 'done', topicId: 'tpc-b', userId },
        // Another user's op on the same topic must not leak in.
        { id: 'op-foreign', status: 'done', topicId: 'tpc-a', userId: otherUserId },
      ]);

      const rows = await model.listByTopic('tpc-a');
      expect(rows.map((row) => row.id)).toEqual(['op-new', 'op-old']);
    });

    it('reports whether a trace was recorded so callers can tell it apart from a failed fetch', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      await serverDB.insert(agentOperations).values([
        {
          id: 'op-with-trace',
          status: 'done',
          topicId: 'tpc-a',
          traceS3Key: 'agent-traces/agt_x/tpc-a/op-with-trace.json.zst',
          userId,
        },
        { id: 'op-without-trace', status: 'done', topicId: 'tpc-a', userId },
      ]);

      const byId = Object.fromEntries(
        (await model.listByTopic('tpc-a')).map((row) => [row.id, row.traceS3Key]),
      );
      expect(byId['op-with-trace']).toBe('agent-traces/agt_x/tpc-a/op-with-trace.json.zst');
      expect(byId['op-without-trace']).toBeNull();
    });

    it('honours the limit', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      await serverDB.insert(agentOperations).values(
        Array.from({ length: 5 }, (_, index) => ({
          createdAt: new Date(2026, 0, index + 1),
          id: `op-${index}`,
          status: 'done' as const,
          topicId: 'tpc-a',
          userId,
        })),
      );

      expect((await model.listByTopic('tpc-a', 2)).map((row) => row.id)).toEqual(['op-4', 'op-3']);
    });
  });
});
