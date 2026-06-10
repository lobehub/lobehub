import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { agentEvalRuns } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { cleanupDB, serverDB, setupEvalChain, setupMultiCaseRun, userId } from './_setup';

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

beforeEach(cleanupDB);

describe('AgentEvalRunService', () => {
  describe('recordTrajectoryCompletion', () => {
    it('should write telemetry and update real-time metrics', async () => {
      const { run, testCase } = await setupEvalChain({
        assistantOutput: 'The answer is 42.',
        datasetEvalMode: 'contains',
        expected: '42',
        totalCases: 1,
      });

      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: {
          completionReason: 'stop',
          cost: 0.05,
          duration: 3000,
          llmCalls: 3,
          steps: 2,
          toolCalls: 5,
          totalTokens: 150,
        },
        testCaseId: testCase.id,
      });

      expect(result.completedCount).toBe(1);
      expect(result.allDone).toBe(true);

      // Verify telemetry was written to RunTopic
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      expect(runTopic?.evalResult).toMatchObject({
        completionReason: 'stop',
        cost: 0.05,
        duration: 3000,
        llmCalls: 3,
        steps: 2,
        tokens: 150,
        toolCalls: 5,
      });

      // Verify evaluation happened (contains "42")
      expect(runTopic?.status).toBe('passed');
      expect(runTopic?.score).toBe(1);

      // Verify run metrics updated in real-time
      const runModel = new AgentEvalRunModel(serverDB, userId);
      const updatedRun = await runModel.findById(run.id);
      expect(updatedRun?.metrics).toMatchObject({
        completedCases: 1,
        passedCases: 1,
        failedCases: 0,
        errorCases: 0,
        // K=1: cost = totalCost (no avg/total distinction)
        cost: 0.05,
        tokens: 150,
        totalCost: 0.05,
        totalDuration: 3000,
        totalTokens: 150,
        // steps/llmCalls/toolCalls = sum of per-case averages
        steps: 2,
        llmCalls: 3,
        toolCalls: 5,
        // perCase = sum / completedCount (1 case)
        perCaseCost: 0.05,
        perCaseTokens: 150,
        perCaseSteps: 2,
        perCaseLlmCalls: 3,
        perCaseToolCalls: 5,
      });
    });

    it('should persist toolCalls and llmCalls in evalResult', async () => {
      const { run, testCase } = await setupEvalChain({
        assistantOutput: '42',
        datasetEvalMode: 'contains',
        expected: '42',
        totalCases: 1,
      });

      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: {
          completionReason: 'stop',
          duration: 1000,
          llmCalls: 7,
          steps: 10,
          toolCalls: 12,
        },
        testCaseId: testCase.id,
      });

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

      expect(runTopic?.evalResult?.steps).toBe(10);
      expect(runTopic?.evalResult?.toolCalls).toBe(12);
      expect(runTopic?.evalResult?.llmCalls).toBe(7);
    });

    it('should persist toolCalls and llmCalls even on error status', async () => {
      const { run, testCase } = await setupEvalChain({
        assistantOutput: null,
        totalCases: 1,
      });

      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        status: 'error',
        telemetry: {
          completionReason: 'error',
          duration: 500,
          llmCalls: 2,
          steps: 3,
          toolCalls: 4,
        },
        testCaseId: testCase.id,
      });

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

      expect(runTopic?.status).toBe('error');
      expect(runTopic?.evalResult?.steps).toBe(3);
      expect(runTopic?.evalResult?.toolCalls).toBe(4);
      expect(runTopic?.evalResult?.llmCalls).toBe(2);
    });

    it('should return allDone=true when all cases complete', async () => {
      const { run, cases } = await setupMultiCaseRun(
        [
          { assistantOutput: '42', expected: '42' },
          { assistantOutput: '42', expected: '42' },
        ],
        { datasetEvalMode: 'contains' },
      );

      const service = new AgentEvalRunService(serverDB, userId);

      const result1 = await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', duration: 100 },
        testCaseId: cases[0].testCase.id,
      });
      expect(result1.allDone).toBe(false);
      expect(result1.completedCount).toBe(1);

      const result2 = await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', duration: 200 },
        testCaseId: cases[1].testCase.id,
      });
      expect(result2.allDone).toBe(true);
      expect(result2.completedCount).toBe(2);
    });

    it('should handle missing RunTopic gracefully', async () => {
      const { run } = await setupEvalChain({ totalCases: 1 });

      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop' },
        testCaseId: 'non-existent-test-case-id',
      });

      // No RunTopic found for this testCaseId, so no telemetry written
      // but progress tracking still works
      expect(result.completedCount).toBe(0);
    });

    it('should short-circuit on error status and skip evaluation', async () => {
      const { run, testCase } = await setupEvalChain({
        assistantOutput: '42',
        datasetEvalMode: 'contains',
        expected: '42',
        totalCases: 1,
      });

      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        status: 'error',
        telemetry: { completionReason: 'insufficient_user_quota', duration: 500 },
        testCaseId: testCase.id,
      });

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

      expect(runTopic?.status).toBe('error');
      expect(runTopic?.passed).toBe(false);
      expect(runTopic?.score).toBe(0);
      expect(runTopic?.evalResult?.error).toBe('Execution error: insufficient_user_quota');

      // Run metrics should reflect error
      const runModel = new AgentEvalRunModel(serverDB, userId);
      const updatedRun = await runModel.findById(run.id);
      expect(updatedRun?.metrics).toMatchObject({
        completedCases: 1,
        errorCases: 1,
        passedCases: 0,
        failedCases: 0,
      });
    });

    it('should write status=error when no assistant output exists', async () => {
      const { run, testCase } = await setupEvalChain({
        assistantOutput: null, // no assistant message
        benchmarkRubrics: [{ config: {}, id: 'r1', name: 'contains', type: 'contains', weight: 1 }],
        expected: '42',
        totalCases: 1,
      });

      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', duration: 100 },
        testCaseId: testCase.id,
      });

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

      expect(runTopic?.status).toBe('error');
      expect(runTopic?.passed).toBe(false);
      expect(runTopic?.score).toBe(0);
      expect(runTopic?.evalResult?.error).toBe('No assistant output');
    });

    it('should write status=failed when evaluation does not pass', async () => {
      const { run, testCase } = await setupEvalChain({
        assistantOutput: 'completely wrong answer',
        datasetEvalMode: 'equals',
        expected: '42',
        totalCases: 1,
      });

      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', duration: 100 },
        testCaseId: testCase.id,
      });

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

      expect(runTopic?.status).toBe('failed');
      expect(runTopic?.passed).toBe(false);
      expect(runTopic?.score).toBe(0);
    });

    it('should accumulate real-time metrics across multiple cases', async () => {
      const { run, cases } = await setupMultiCaseRun(
        [
          { assistantOutput: '42', expected: '42' },
          { assistantOutput: 'wrong', expected: '42' },
          { assistantOutput: '42', expected: '42' },
        ],
        { datasetEvalMode: 'equals' },
      );

      const service = new AgentEvalRunService(serverDB, userId);

      // Complete case 1 (pass)
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: {
          completionReason: 'stop',
          cost: 0.01,
          duration: 1000,
          llmCalls: 2,
          steps: 3,
          toolCalls: 1,
          totalTokens: 50,
        },
        testCaseId: cases[0].testCase.id,
      });

      // Complete case 2 (fail)
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: {
          completionReason: 'stop',
          cost: 0.02,
          duration: 2000,
          llmCalls: 4,
          steps: 6,
          toolCalls: 3,
          totalTokens: 80,
        },
        testCaseId: cases[1].testCase.id,
      });

      // Complete case 3 with error
      await service.recordTrajectoryCompletion({
        runId: run.id,
        status: 'error',
        telemetry: {
          completionReason: 'rate_limit',
          cost: 0.005,
          duration: 500,
          llmCalls: 1,
          steps: 1,
          toolCalls: 0,
          totalTokens: 10,
        },
        testCaseId: cases[2].testCase.id,
      });

      const runModel = new AgentEvalRunModel(serverDB, userId);
      const updatedRun = await runModel.findById(run.id);

      expect(updatedRun?.metrics).toMatchObject({
        completedCases: 3,
        passedCases: 1,
        failedCases: 1,
        errorCases: 1,
        tokens: 140,
        totalDuration: 3500,
        totalTokens: 140,
        // steps/llmCalls/toolCalls accumulate across cases
        steps: 10, // 3 + 6 + 1
        llmCalls: 7, // 2 + 4 + 1
        toolCalls: 4, // 1 + 3 + 0
      });
      // Use toBeCloseTo for floating-point cost values
      expect((updatedRun?.metrics as any).cost).toBeCloseTo(0.035);
      expect((updatedRun?.metrics as any).totalCost).toBeCloseTo(0.035);
      // perCase = sum / completedCount (3 cases)
      expect((updatedRun?.metrics as any).perCaseCost).toBeCloseTo(0.035 / 3);
      expect((updatedRun?.metrics as any).perCaseTokens).toBe(47); // Math.round(140 / 3)
      expect((updatedRun?.metrics as any).perCaseSteps).toBeCloseTo(3.3); // round1(10 / 3)
      expect((updatedRun?.metrics as any).perCaseLlmCalls).toBeCloseTo(2.3); // round1(7 / 3)
      expect((updatedRun?.metrics as any).perCaseToolCalls).toBeCloseTo(1.3); // round1(4 / 3)
    });
  });

  describe('recordTrajectoryCompletion - timeout counting', () => {
    it('should count timeout topics in completedCount', async () => {
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

      // Manually mark case 2 as timeout with evalResult (simulating what checkAndHandleRunTimeout does)
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const case2RT = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);
      await runTopicModel.updateByRunAndTopic(case2RT!.runId, case2RT!.topicId, {
        evalResult: { completionReason: 'timeout', duration: 1_200_000, rubricScores: [] },
        passed: false,
        score: 0,
        status: 'timeout',
      });

      // Now complete case 1 normally
      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', cost: 0.01, duration: 2000, totalTokens: 100 },
        testCaseId: cases[0].testCase.id,
      });

      expect(result.completedCount).toBe(2); // 1 normal + 1 timeout
      expect(result.allDone).toBe(true);

      // Verify metrics include timeoutCases
      const updatedRun = await runModel.findById(run.id);
      expect(updatedRun?.metrics).toMatchObject({
        completedCases: 2,
        passedCases: 1,
        timeoutCases: 1,
      });
    });
  });

  describe('recordTrajectoryCompletion - re-entry guard', () => {
    it('should skip telemetry and evaluation when topic is already in timeout state', async () => {
      const { run, testCase } = await setupEvalChain({
        assistantOutput: '42',
        datasetEvalMode: 'contains',
        expected: '42',
        totalCases: 1,
      });

      // Manually mark the topic as timeout (simulating what checkAndHandleRunTimeout does)
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      await runTopicModel.updateByRunAndTopic(rt!.runId, rt!.topicId, {
        evalResult: { completionReason: 'timeout', duration: 1_200_000, rubricScores: [] },
        passed: false,
        score: 0,
        status: 'timeout',
      });

      // Now the interrupted agent fires its completion webhook
      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: {
          completionReason: 'interrupted',
          cost: 0.05,
          duration: 1_200_500,
          llmCalls: 3,
          steps: 2,
          toolCalls: 5,
          totalTokens: 150,
        },
        testCaseId: testCase.id,
      });

      // Progress tracking should still count this topic
      expect(result.completedCount).toBe(1);
      expect(result.allDone).toBe(true);

      // But the topic should retain its original timeout state, not be overwritten
      const updatedRt = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      expect(updatedRt?.status).toBe('timeout');
      expect(updatedRt?.evalResult?.completionReason).toBe('timeout');
      expect(updatedRt?.evalResult?.duration).toBe(1_200_000);
      // Should NOT have the interrupted agent's telemetry
      expect(updatedRt?.evalResult?.cost).toBeUndefined();
    });

    it('should skip telemetry when topic is already in error state', async () => {
      const { run, testCase } = await setupEvalChain({
        assistantOutput: null,
        totalCases: 1,
      });

      // Mark as error first
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      await runTopicModel.updateByRunAndTopic(rt!.runId, rt!.topicId, {
        evalResult: { error: 'quota exceeded', rubricScores: [] },
        passed: false,
        score: 0,
        status: 'error',
      });

      // Agent fires completion webhook with reason 'interrupted'
      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'interrupted', duration: 500 },
        testCaseId: testCase.id,
      });

      // Status should remain 'error', not overwritten
      const updatedRt = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      expect(updatedRt?.status).toBe('error');
      expect(updatedRt?.evalResult?.error).toBe('quota exceeded');
    });

    it('should skip telemetry when topic is already in passed state', async () => {
      const { run, testCase } = await setupEvalChain({
        assistantOutput: '42',
        datasetEvalMode: 'contains',
        expected: '42',
        totalCases: 1,
      });

      // Complete normally first
      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', cost: 0.01, duration: 1000 },
        testCaseId: testCase.id,
      });

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt1 = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      expect(rt1?.status).toBe('passed');

      // Second completion call (e.g. duplicate webhook) should not overwrite
      await service.recordTrajectoryCompletion({
        runId: run.id,
        status: 'error',
        telemetry: { completionReason: 'error', duration: 9999 },
        testCaseId: testCase.id,
      });

      const rt2 = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      expect(rt2?.status).toBe('passed');
      expect(rt2?.evalResult?.duration).toBe(1000); // original, not overwritten
    });
  });
});
