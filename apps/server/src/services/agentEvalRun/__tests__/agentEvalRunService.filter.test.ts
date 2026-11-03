import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunTopicModel } from '@/database/models/agentEval';

import { cleanupDB, serverDB, setupMultiCaseRun, userId } from './_setup';

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

beforeEach(cleanupDB);

describe('AgentEvalRunService', () => {
  describe('filterTestCasesNeedingExecution', () => {
    it('should only return test cases with pending status', async () => {
      const { run, cases } = await setupMultiCaseRun([
        { assistantOutput: null },
        { assistantOutput: null },
        { assistantOutput: null },
      ]);

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);

      // Mark case 2 as running (should be excluded)
      const rt2 = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt2!.runId, rt2!.topicId, { status: 'running' });

      // Mark case 3 as passed (should be excluded)
      const rt3 = await runTopicModel.findByRunAndTestCase(run.id, cases[2].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt3!.runId, rt3!.topicId, {
        passed: true,
        score: 1,
        status: 'passed',
      });

      // Mark case 1 as pending
      const rt1 = await runTopicModel.findByRunAndTestCase(run.id, cases[0].testCase.id);
      await runTopicModel.updateByRunAndTopic(rt1!.runId, rt1!.topicId, { status: 'pending' });

      const { AgentEvalRunWorkflow } = await import('@/server/workflows/agentEvalRun');
      const needExecution = await AgentEvalRunWorkflow.filterTestCasesNeedingExecution(serverDB, {
        runId: run.id,
        testCaseIds: cases.map((c) => c.testCase.id),
        userId,
      });

      // Only case 1 (pending) should need execution
      expect(needExecution).toHaveLength(1);
      expect(needExecution[0]).toBe(cases[0].testCase.id);
    });
  });
});
