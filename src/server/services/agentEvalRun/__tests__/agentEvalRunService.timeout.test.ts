import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { agentEvalRuns, agentEvalRunTopics } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { AgentRuntimeService } from '@/server/services/agentRuntime/AgentRuntimeService';

import { cleanupDB, serverDB, setupMultiCaseRun, userId } from './_setup';

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

beforeEach(cleanupDB);

describe('AgentEvalRunService', () => {
  describe('checkAndHandleRunTimeout', () => {
    it('should write evalResult with duration and completionReason for timed-out topics', async () => {
      const { run } = await setupMultiCaseRun([
        { assistantOutput: null },
        { assistantOutput: null },
      ]);

      // Set run as 'running' with startedAt 30 min ago
      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });
      await serverDB
        .update(agentEvalRuns)
        .set({ startedAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRuns.id, run.id));

      // Mark all RunTopics as running and backdate to 25 min ago
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'`, status: 'running' })
        .where(eq(agentEvalRunTopics.runId, run.id));

      const updatedRun = await runModel.findById(run.id);
      const service = new AgentEvalRunService(serverDB, userId);
      const changed = await service.checkAndHandleRunTimeout({
        ...updatedRun!,
        config: { timeout: 1_200_000 }, // 20 min
      });

      expect(changed).toBe(true);

      // Verify evalResult written with duration
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const allTopics = await runTopicModel.findByRunId(run.id);

      for (const t of allTopics) {
        expect(t.status).toBe('timeout');
        expect(t.passed).toBe(false);
        expect(t.score).toBe(0);
        expect(t.evalResult).toMatchObject({
          completionReason: 'timeout',
        });
        // Duration should be roughly 25 min (±5s tolerance)
        expect((t.evalResult as any).duration).toBeGreaterThan(1_400_000);
        expect((t.evalResult as any).duration).toBeLessThan(1_600_000);
      }
    });

    it('should finalize run when all topics reach terminal state after timeout', async () => {
      const { run, cases } = await setupMultiCaseRun(
        [{ assistantOutput: '42', expected: '42' }, { assistantOutput: null }],
        { datasetEvalMode: 'contains' },
      );

      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });
      await serverDB
        .update(agentEvalRuns)
        .set({ startedAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRuns.id, run.id));

      // Complete case 1 normally via recordTrajectoryCompletion
      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', cost: 0.01, duration: 2000, totalTokens: 100 },
        testCaseId: cases[0].testCase.id,
      });

      // Mark case 2's RunTopic as running and backdate to 25 min ago (so it will time out)
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const case2RunTopic = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'`, status: 'running' })
        .where(eq(agentEvalRunTopics.topicId, case2RunTopic!.topicId));

      // Now trigger timeout check
      const freshRun = await runModel.findById(run.id);
      const changed = await service.checkAndHandleRunTimeout({
        ...freshRun!,
        config: { timeout: 1_200_000 },
      });

      expect(changed).toBe(true);

      // Run should be finalized (no pending topics left)
      const finalRun = await runModel.findById(run.id);
      expect(finalRun?.status).toBe('completed');
      expect(finalRun?.metrics).toMatchObject({
        totalCases: 2,
        passedCases: 1,
        timeoutCases: 1,
      });
      expect((finalRun?.metrics as any).totalCost).toBeCloseTo(0.01);
    });

    it('should not finalize if some topics are still pending', async () => {
      const { run, cases } = await setupMultiCaseRun([
        { assistantOutput: null },
        { assistantOutput: null },
      ]);

      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });
      await serverDB
        .update(agentEvalRuns)
        .set({ startedAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRuns.id, run.id));

      // Mark case 1 as running and backdate (case 2 stays recent → still pending)
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const case1RunTopic = await runTopicModel.findByRunAndTestCase(run.id, cases[0].testCase.id);
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'`, status: 'running' })
        .where(eq(agentEvalRunTopics.topicId, case1RunTopic!.topicId));

      const freshRun = await runModel.findById(run.id);
      const service = new AgentEvalRunService(serverDB, userId);
      const changed = await service.checkAndHandleRunTimeout({
        ...freshRun!,
        config: { timeout: 1_200_000 },
      });

      expect(changed).toBe(true);

      // Run should still be 'running' — case 2 is still pending
      const afterRun = await runModel.findById(run.id);
      expect(afterRun?.status).toBe('running');
    });

    it('should mark run as failed when all cases are timeout', async () => {
      const { run } = await setupMultiCaseRun([
        { assistantOutput: null },
        { assistantOutput: null },
      ]);

      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });
      await serverDB
        .update(agentEvalRuns)
        .set({ startedAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRuns.id, run.id));

      // Mark all RunTopics as running and backdate
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'`, status: 'running' })
        .where(eq(agentEvalRunTopics.runId, run.id));

      const freshRun = await runModel.findById(run.id);
      const service = new AgentEvalRunService(serverDB, userId);
      await service.checkAndHandleRunTimeout({
        ...freshRun!,
        config: { timeout: 1_200_000 },
      });

      const finalRun = await runModel.findById(run.id);
      expect(finalRun?.status).toBe('failed');
      expect(finalRun?.metrics).toMatchObject({
        totalCases: 2,
        timeoutCases: 2,
        passedCases: 0,
        failedCases: 0,
        errorCases: 0,
      });
    });

    it('should mark run as failed when all cases are error + timeout', async () => {
      const { run, cases } = await setupMultiCaseRun([
        { assistantOutput: null },
        { assistantOutput: null },
      ]);

      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });
      await serverDB
        .update(agentEvalRuns)
        .set({ startedAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRuns.id, run.id));

      // Complete case 1 as error
      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        status: 'error',
        telemetry: { completionReason: 'rate_limit', duration: 500, errorMessage: 'Rate limited' },
        testCaseId: cases[0].testCase.id,
      });

      // Mark case 2 as running and backdate to trigger timeout
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const case2RunTopic = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'`, status: 'running' })
        .where(eq(agentEvalRunTopics.topicId, case2RunTopic!.topicId));

      const freshRun = await runModel.findById(run.id);
      await service.checkAndHandleRunTimeout({
        ...freshRun!,
        config: { timeout: 1_200_000 },
      });

      const finalRun = await runModel.findById(run.id);
      expect(finalRun?.status).toBe('failed');
      expect(finalRun?.metrics).toMatchObject({
        totalCases: 2,
        errorCases: 1,
        timeoutCases: 1,
        passedCases: 0,
      });
    });

    it('should return false and skip when run started less than timeout ago', async () => {
      const service = new AgentEvalRunService(serverDB, userId);
      const changed = await service.checkAndHandleRunTimeout({
        config: { timeout: 1_200_000 },
        id: 'any-run-id',
        startedAt: new Date(), // just now
      });

      expect(changed).toBe(false);
    });
  });

  describe('checkAndHandleRunTimeout - agent interruption', () => {
    it('should call interruptOperation for timed-out topics with operationId', async () => {
      const { run, cases } = await setupMultiCaseRun([
        { assistantOutput: null },
        { assistantOutput: null },
      ]);

      // Store operationId in evalResult for both topics
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt1 = await runTopicModel.findByRunAndTestCase(run.id, cases[0].testCase.id);
      const rt2 = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);

      await runTopicModel.updateByRunAndTopic(rt1!.runId, rt1!.topicId, {
        evalResult: { operationId: 'op-aaa', rubricScores: [] },
      });
      await runTopicModel.updateByRunAndTopic(rt2!.runId, rt2!.topicId, {
        evalResult: { operationId: 'op-bbb', rubricScores: [] },
      });

      // Set run as 'running' with startedAt 30 min ago
      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });
      await serverDB
        .update(agentEvalRuns)
        .set({ startedAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRuns.id, run.id));

      // Mark all RunTopics as running and backdate to 25 min ago
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'`, status: 'running' })
        .where(eq(agentEvalRunTopics.runId, run.id));

      // Clear mock call history
      vi.mocked(AgentRuntimeService).mockClear();

      const freshRun = await runModel.findById(run.id);
      const service = new AgentEvalRunService(serverDB, userId);
      await service.checkAndHandleRunTimeout({
        ...freshRun!,
        config: { timeout: 1_200_000 },
      });

      // Verify AgentRuntimeService was instantiated
      expect(AgentRuntimeService).toHaveBeenCalledWith(serverDB, userId);

      // Verify interruptOperation was called for both operationIds
      const mockInstance = vi.mocked(AgentRuntimeService).mock.results[0].value;
      expect(mockInstance.interruptOperation).toHaveBeenCalledTimes(2);
      expect(mockInstance.interruptOperation).toHaveBeenCalledWith('op-aaa');
      expect(mockInstance.interruptOperation).toHaveBeenCalledWith('op-bbb');
    });

    it('should skip interrupt for topics without operationId', async () => {
      const { run } = await setupMultiCaseRun([{ assistantOutput: null }]);

      // No operationId in evalResult (legacy topic or operationId not stored)
      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });
      await serverDB
        .update(agentEvalRuns)
        .set({ startedAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRuns.id, run.id));
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'`, status: 'running' })
        .where(eq(agentEvalRunTopics.runId, run.id));

      vi.mocked(AgentRuntimeService).mockClear();

      const freshRun = await runModel.findById(run.id);
      const service = new AgentEvalRunService(serverDB, userId);
      await service.checkAndHandleRunTimeout({
        ...freshRun!,
        config: { timeout: 1_200_000 },
      });

      // AgentRuntimeService is still instantiated but interruptOperation not called
      const mockInstance = vi.mocked(AgentRuntimeService).mock.results[0].value;
      expect(mockInstance.interruptOperation).not.toHaveBeenCalled();
    });

    it('should continue timeout handling even if interruptOperation throws', async () => {
      const { run, cases } = await setupMultiCaseRun([{ assistantOutput: null }]);

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt = await runTopicModel.findByRunAndTestCase(run.id, cases[0].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt!.runId, rt!.topicId, {
        evalResult: { operationId: 'op-failing', rubricScores: [] },
      });

      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });
      await serverDB
        .update(agentEvalRuns)
        .set({ startedAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRuns.id, run.id));
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'`, status: 'running' })
        .where(eq(agentEvalRunTopics.runId, run.id));

      // Make interruptOperation throw
      vi.mocked(AgentRuntimeService).mockClear();
      vi.mocked(AgentRuntimeService).mockImplementationOnce(
        () =>
          ({
            interruptOperation: vi.fn().mockRejectedValue(new Error('Redis connection failed')),
          }) as any,
      );

      const freshRun = await runModel.findById(run.id);
      const service = new AgentEvalRunService(serverDB, userId);
      const changed = await service.checkAndHandleRunTimeout({
        ...freshRun!,
        config: { timeout: 1_200_000 },
      });

      // Timeout handling should still succeed despite interrupt failure
      expect(changed).toBe(true);

      const allTopics = await runTopicModel.findByRunId(run.id);
      expect(allTopics[0].status).toBe('timeout');
    });
  });

  describe('batchMarkTimeout - running status only', () => {
    it('should only mark running topics as timeout, not null or pending', async () => {
      const { run, cases } = await setupMultiCaseRun([
        { assistantOutput: null },
        { assistantOutput: null },
        { assistantOutput: null },
      ]);

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);

      // Case 1: leave status as null (default)
      // Case 2: set status to 'pending'
      const rt2 = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt2!.runId, rt2!.topicId, { status: 'pending' });

      // Case 3: set status to 'running'
      const rt3 = await runTopicModel.findByRunAndTestCase(run.id, cases[2].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt3!.runId, rt3!.topicId, { status: 'running' });

      // Backdate all RunTopics so they exceed timeout
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'` })
        .where(eq(agentEvalRunTopics.runId, run.id));

      // Execute batchMarkTimeout
      const timedOut = await runTopicModel.batchMarkTimeout(run.id, 1_200_000);

      // Only case 3 (running) should be marked as timeout
      expect(timedOut).toHaveLength(1);

      // Verify statuses
      const allTopics = await runTopicModel.findByRunId(run.id);
      const statusMap = new Map(allTopics.map((t) => [t.testCaseId, t.status]));

      expect(statusMap.get(cases[0].testCase.id)).toBeNull(); // still null
      expect(statusMap.get(cases[1].testCase.id)).toBe('pending'); // still pending
      expect(statusMap.get(cases[2].testCase.id)).toBe('timeout'); // timed out
    });
  });

  describe('checkAndHandleRunTimeout - real-time metrics update', () => {
    it('should update metrics when some topics still running after timeout', async () => {
      const { run, cases } = await setupMultiCaseRun(
        [
          { assistantOutput: '42', expected: '42' },
          { assistantOutput: null },
          { assistantOutput: null },
        ],
        { datasetEvalMode: 'contains' },
      );

      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });
      await serverDB
        .update(agentEvalRuns)
        .set({ startedAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRuns.id, run.id));

      // Complete case 1 normally
      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', cost: 0.01, duration: 2000, totalTokens: 100 },
        testCaseId: cases[0].testCase.id,
      });

      // Mark case 2 as running and backdate (will time out)
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt2 = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'`, status: 'running' })
        .where(eq(agentEvalRunTopics.topicId, rt2!.topicId));

      // Case 3: stays recent with null status (still pending, not timed out)

      const freshRun = await runModel.findById(run.id);
      const changed = await service.checkAndHandleRunTimeout({
        ...freshRun!,
        config: { timeout: 1_200_000 },
      });

      expect(changed).toBe(true);

      // Run should still be running (case 3 is pending)
      const afterRun = await runModel.findById(run.id);
      expect(afterRun?.status).toBe('running');

      // Metrics should be updated with timeout info
      expect(afterRun?.metrics).toMatchObject({
        completedCases: 2, // 1 passed + 1 timeout
        passedCases: 1,
        timeoutCases: 1,
      });
    });
  });
});
