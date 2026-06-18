import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { topics } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { AgentRuntimeService } from '@/server/services/agentRuntime/AgentRuntimeService';

import { cleanupDB, serverDB, setupEvalChain, setupMultiCaseRun, userId } from './_setup';

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

beforeEach(cleanupDB);

describe('AgentEvalRunService', () => {
  describe('retryErrorCases', () => {
    it('should delete error/timeout RunTopics and orphan topics, set run to pending', async () => {
      const { run, cases } = await setupMultiCaseRun(
        [
          { assistantOutput: '42', expected: '42' },
          { assistantOutput: null },
          { assistantOutput: null },
        ],
        { datasetEvalMode: 'contains' },
      );

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const service = new AgentEvalRunService(serverDB, userId);

      // Complete case 1 as passed
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', duration: 1000 },
        testCaseId: cases[0].testCase.id,
      });

      // Mark case 2 as error
      const rt2 = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt2!.runId, rt2!.topicId, {
        evalResult: { error: 'quota exceeded', rubricScores: [] },
        passed: false,
        score: 0,
        status: 'error',
      });

      // Mark case 3 as timeout
      const rt3 = await runTopicModel.findByRunAndTestCase(run.id, cases[2].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt3!.runId, rt3!.topicId, {
        evalResult: { completionReason: 'timeout', duration: 1_200_000, rubricScores: [] },
        passed: false,
        score: 0,
        status: 'timeout',
      });

      // Set run as completed
      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'completed' });

      // Execute retryErrorCases
      const result = await service.retryErrorCases(run.id);

      expect(result.retryCount).toBe(2); // error + timeout

      // Run should be pending
      const updatedRun = await runModel.findById(run.id);
      expect(updatedRun?.status).toBe('pending');

      // Should have 3 RunTopics: 1 passed + 2 new pending
      const remainingTopics = await runTopicModel.findByRunId(run.id);
      expect(remainingTopics).toHaveLength(3);

      const passedTopics = remainingTopics.filter((t) => t.status === 'passed');
      const pendingTopics = remainingTopics.filter((t) => t.status === 'pending');
      expect(passedTopics).toHaveLength(1);
      expect(pendingTopics).toHaveLength(2);

      // Old orphan topics for error/timeout cases should be deleted
      const [topic2] = await serverDB.select().from(topics).where(eq(topics.id, cases[1].topic.id));
      const [topic3] = await serverDB.select().from(topics).where(eq(topics.id, cases[2].topic.id));
      expect(topic2).toBeUndefined();
      expect(topic3).toBeUndefined();

      // New pending RunTopics should have new topic IDs (not the old ones)
      const newTopicIds = pendingTopics.map((t) => t.topicId);
      expect(newTopicIds).not.toContain(cases[1].topic.id);
      expect(newTopicIds).not.toContain(cases[2].topic.id);

      // Passed case's topic should still exist
      const [topic1] = await serverDB.select().from(topics).where(eq(topics.id, cases[0].topic.id));
      expect(topic1).toBeDefined();
    });

    it('should return retryCount=0 when no error cases exist', async () => {
      const { run, cases } = await setupMultiCaseRun([{ assistantOutput: '42', expected: '42' }], {
        datasetEvalMode: 'contains',
      });

      const service = new AgentEvalRunService(serverDB, userId);

      // Complete case as passed
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', duration: 1000 },
        testCaseId: cases[0].testCase.id,
      });

      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'completed' });

      const result = await service.retryErrorCases(run.id);
      expect(result.retryCount).toBe(0);

      // Run status should remain completed (not changed to pending)
      const updatedRun = await runModel.findById(run.id);
      expect(updatedRun?.status).toBe('completed');
    });

    it('should throw when run not found', async () => {
      const service = new AgentEvalRunService(serverDB, userId);
      await expect(service.retryErrorCases('non-existent-id')).rejects.toThrow('Run not found');
    });
  });

  describe('deleteErrorRunTopics', () => {
    it('should only delete error and timeout RunTopics, not passed or failed', async () => {
      const { run, cases } = await setupMultiCaseRun([
        { assistantOutput: null },
        { assistantOutput: null },
        { assistantOutput: null },
        { assistantOutput: null },
      ]);

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);

      // Mark case 1 as passed
      const rt1 = await runTopicModel.findByRunAndTestCase(run.id, cases[0].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt1!.runId, rt1!.topicId, {
        passed: true,
        score: 1,
        status: 'passed',
      });

      // Mark case 2 as failed
      const rt2 = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt2!.runId, rt2!.topicId, {
        passed: false,
        score: 0,
        status: 'failed',
      });

      // Mark case 3 as error
      const rt3 = await runTopicModel.findByRunAndTestCase(run.id, cases[2].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt3!.runId, rt3!.topicId, {
        passed: false,
        score: 0,
        status: 'error',
      });

      // Mark case 4 as timeout
      const rt4 = await runTopicModel.findByRunAndTestCase(run.id, cases[3].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt4!.runId, rt4!.topicId, {
        passed: false,
        score: 0,
        status: 'timeout',
      });

      // Execute deleteErrorRunTopics
      const deleted = await runTopicModel.deleteErrorRunTopics(run.id);
      expect(deleted).toHaveLength(2); // error + timeout

      // Verify only passed and failed remain
      const remaining = await runTopicModel.findByRunId(run.id);
      expect(remaining).toHaveLength(2);

      const statuses = remaining.map((t) => t.status).sort();
      expect(statuses).toEqual(['failed', 'passed']);
    });
  });

  describe('abortRun', () => {
    it('should update run status to aborted and interrupt running operations', async () => {
      const { run, cases } = await setupMultiCaseRun([
        { assistantOutput: null },
        { assistantOutput: null },
      ]);

      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });

      // Store operationId in evalResult for running topics
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt1 = await runTopicModel.findByRunAndTestCase(run.id, cases[0].testCase.id);
      const rt2 = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);

      await runTopicModel.updateByRunAndTopic(rt1!.runId, rt1!.topicId, {
        evalResult: { operationId: 'op-111', rubricScores: [] },
        status: 'running',
      });
      await runTopicModel.updateByRunAndTopic(rt2!.runId, rt2!.topicId, {
        evalResult: { operationId: 'op-222', rubricScores: [] },
        status: 'running',
      });

      vi.mocked(AgentRuntimeService).mockClear();

      const service = new AgentEvalRunService(serverDB, userId);
      await service.abortRun(run.id);

      // Verify run status updated to aborted
      const updatedRun = await runModel.findById(run.id);
      expect(updatedRun?.status).toBe('aborted');

      // Verify interruptOperation called for both operations
      const mockInstance = vi.mocked(AgentRuntimeService).mock.results[0].value;
      expect(mockInstance.interruptOperation).toHaveBeenCalledTimes(2);
      expect(mockInstance.interruptOperation).toHaveBeenCalledWith('op-111');
      expect(mockInstance.interruptOperation).toHaveBeenCalledWith('op-222');
    });

    it('should skip interrupt for topics without operationId', async () => {
      const { run, cases } = await setupMultiCaseRun([{ assistantOutput: null }]);

      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });

      // Set status to running but no operationId in evalResult
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt = await runTopicModel.findByRunAndTestCase(run.id, cases[0].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt!.runId, rt!.topicId, { status: 'running' });

      vi.mocked(AgentRuntimeService).mockClear();

      const service = new AgentEvalRunService(serverDB, userId);
      await service.abortRun(run.id);

      const updatedRun = await runModel.findById(run.id);
      expect(updatedRun?.status).toBe('aborted');

      // interruptOperation should not be called (no operationId)
      const mockInstance = vi.mocked(AgentRuntimeService).mock.results[0].value;
      expect(mockInstance.interruptOperation).not.toHaveBeenCalled();
    });

    it('should not interrupt already completed topics', async () => {
      const { run, cases } = await setupMultiCaseRun(
        [{ assistantOutput: '42', expected: '42' }, { assistantOutput: null }],
        { datasetEvalMode: 'contains' },
      );

      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running' });

      // Complete case 1
      const service = new AgentEvalRunService(serverDB, userId);
      await service.recordTrajectoryCompletion({
        runId: run.id,
        telemetry: { completionReason: 'stop', duration: 1000 },
        testCaseId: cases[0].testCase.id,
      });

      // Case 2 is running with operationId
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt2 = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt2!.runId, rt2!.topicId, {
        evalResult: { operationId: 'op-only-running', rubricScores: [] },
        status: 'running',
      });

      vi.mocked(AgentRuntimeService).mockClear();

      await service.abortRun(run.id);

      // Only the running topic's operation should be interrupted
      const mockInstance = vi.mocked(AgentRuntimeService).mock.results[0].value;
      expect(mockInstance.interruptOperation).toHaveBeenCalledTimes(1);
      expect(mockInstance.interruptOperation).toHaveBeenCalledWith('op-only-running');
    });
  });

  describe('deleteRun', () => {
    it('should delete run and associated topics', async () => {
      const { run } = await setupEvalChain({ totalCases: 1 });

      const service = new AgentEvalRunService(serverDB, userId);
      await service.deleteRun(run.id);

      const runModel = new AgentEvalRunModel(serverDB, userId);
      const deletedRun = await runModel.findById(run.id);
      expect(deletedRun).toBeUndefined();
    });
  });
});
