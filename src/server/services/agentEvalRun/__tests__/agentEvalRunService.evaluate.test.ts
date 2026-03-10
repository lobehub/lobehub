import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { cleanupDB, serverDB, userId } from './_setup';

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

beforeEach(cleanupDB);

describe('AgentEvalRunService', () => {
  describe('evaluateAndFinalizeRun', () => {
    it('should aggregate already-evaluated RunTopics into correct metrics', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        run: { id: 'run-1', startedAt: new Date(Date.now() - 10_000) },
        runTopics: [
          {
            evalResult: {
              cost: 0.01,
              duration: 1000,
              llmCalls: 3,
              rubricScores: [{ rubricId: 'r1', score: 1 }],
              steps: 5,
              tokens: 50,
              toolCalls: 2,
            },
            passed: true,
            runId: 'run-1',
            score: 1,
            status: 'passed',
            topicId: 'topic-1',
          },
          {
            evalResult: {
              cost: 0.02,
              duration: 2000,
              llmCalls: 4,
              rubricScores: [{ rubricId: 'r1', score: 0.5 }],
              steps: 8,
              tokens: 80,
              toolCalls: 6,
            },
            passed: false,
            runId: 'run-1',
            score: 0.5,
            status: 'failed',
            topicId: 'topic-2',
          },
        ],
      });

      expect(metrics.totalCases).toBe(2);
      expect(metrics.passedCases).toBe(1);
      expect(metrics.failedCases).toBe(1);
      expect(metrics.errorCases).toBe(0);
      expect(metrics.passRate).toBe(0.5);
      expect(metrics.averageScore).toBe(0.75);
      // cost/tokens = sum of per-case averages (K=1: avg == raw)
      expect(metrics.cost).toBeCloseTo(0.03);
      expect(metrics.tokens).toBe(130);
      // totalCost/totalTokens/totalDuration = actual cumulative (K=1: same as cost/tokens)
      expect(metrics.totalDuration).toBe(3000);
      expect(metrics.totalCost).toBeCloseTo(0.03);
      expect(metrics.totalTokens).toBe(130);
      // steps/llmCalls/toolCalls = sum of per-case averages
      expect(metrics.steps).toBe(13); // 5 + 8
      expect(metrics.llmCalls).toBe(7); // 3 + 4
      expect(metrics.toolCalls).toBe(8); // 2 + 6
      // perCase = sum / totalCases
      expect(metrics.perCaseCost).toBeCloseTo(0.015); // 0.03 / 2
      expect(metrics.perCaseTokens).toBe(65); // 130 / 2
      expect(metrics.perCaseSteps).toBe(6.5); // 13 / 2
      expect(metrics.perCaseLlmCalls).toBe(3.5); // 7 / 2
      expect(metrics.perCaseToolCalls).toBe(4); // 8 / 2
      expect(metrics.rubricScores).toEqual({ r1: 0.75 });
      expect(metrics.duration).toBeGreaterThanOrEqual(9000);
    });

    it('should count errorCases separately and exclude from averageScore', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        run: { id: 'run-1' },
        runTopics: [
          {
            evalResult: { rubricScores: [{ rubricId: 'r1', score: 1 }] },
            passed: true,
            runId: 'run-1',
            score: 1,
            status: 'passed',
            topicId: 't1',
          },
          {
            evalResult: { rubricScores: [{ rubricId: 'r1', score: 0.3 }] },
            passed: false,
            runId: 'run-1',
            score: 0.3,
            status: 'failed',
            topicId: 't2',
          },
          {
            evalResult: { error: 'Execution error: quota', rubricScores: [] },
            passed: false,
            runId: 'run-1',
            score: 0,
            status: 'error',
            topicId: 't3',
          },
          {
            evalResult: { error: 'Execution error: rate_limit', rubricScores: [] },
            passed: false,
            runId: 'run-1',
            score: 0,
            status: 'error',
            topicId: 't4',
          },
        ],
      });

      expect(metrics.totalCases).toBe(4);
      expect(metrics.passedCases).toBe(1);
      expect(metrics.failedCases).toBe(1);
      expect(metrics.errorCases).toBe(2);
      // passRate uses totalCases as denominator: 1/4
      expect(metrics.passRate).toBe(0.25);
      // averageScore excludes errors: (1 + 0.3) / 2
      expect(metrics.averageScore).toBeCloseTo(0.65);
    });

    it('should handle all error cases', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        run: { id: 'run-1' },
        runTopics: [
          {
            evalResult: { error: 'err', rubricScores: [] },
            passed: false,
            runId: 'r',
            score: 0,
            status: 'error',
            topicId: 't1',
          },
          {
            evalResult: { error: 'err', rubricScores: [] },
            passed: false,
            runId: 'r',
            score: 0,
            status: 'error',
            topicId: 't2',
          },
        ],
      });

      expect(metrics.passRate).toBe(0);
      expect(metrics.averageScore).toBe(0);
      expect(metrics.errorCases).toBe(2);
    });

    it('should handle empty runTopics', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        run: { id: 'run-1' },
        runTopics: [],
      });

      expect(metrics.totalCases).toBe(0);
      expect(metrics.passRate).toBe(0);
      expect(metrics.averageScore).toBe(0);
    });

    it('should handle RunTopics with null status (unevaluated)', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        run: { id: 'run-1' },
        runTopics: [
          {
            evalResult: { duration: 1000, rubricScores: [] },
            passed: null,
            runId: 'r',
            score: null,
            status: null,
            topicId: 't1',
          },
        ],
      });

      expect(metrics.totalCases).toBe(1);
      expect(metrics.passedCases).toBe(0);
      expect(metrics.failedCases).toBe(0);
      expect(metrics.errorCases).toBe(0);
    });
  });

  describe('evaluateAndFinalizeRun - timeout cases', () => {
    it('should count timeoutCases and exclude from averageScore', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        run: { id: 'run-1' },
        runTopics: [
          {
            evalResult: { duration: 1000, rubricScores: [{ rubricId: 'r1', score: 1 }] },
            passed: true,
            runId: 'run-1',
            score: 1,
            status: 'passed',
            topicId: 't1',
          },
          {
            evalResult: { completionReason: 'timeout', duration: 1_200_000, rubricScores: [] },
            passed: false,
            runId: 'run-1',
            score: 0,
            status: 'timeout',
            topicId: 't2',
          },
          {
            evalResult: { error: 'Execution error', rubricScores: [] },
            passed: false,
            runId: 'run-1',
            score: 0,
            status: 'error',
            topicId: 't3',
          },
        ],
      });

      expect(metrics.totalCases).toBe(3);
      expect(metrics.passedCases).toBe(1);
      expect(metrics.failedCases).toBe(0);
      expect(metrics.errorCases).toBe(1);
      expect(metrics.timeoutCases).toBe(1);
      // passRate uses totalCases as denominator: 1/3
      expect(metrics.passRate).toBeCloseTo(1 / 3);
      expect(metrics.averageScore).toBe(1);
      // timeout duration should be accumulated
      expect(metrics.totalDuration).toBe(1_201_000);
    });

    it('should handle all timeout cases', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        run: { id: 'run-1' },
        runTopics: [
          {
            evalResult: { completionReason: 'timeout', duration: 1_200_000, rubricScores: [] },
            passed: false,
            runId: 'r',
            score: 0,
            status: 'timeout',
            topicId: 't1',
          },
          {
            evalResult: { completionReason: 'timeout', duration: 1_200_000, rubricScores: [] },
            passed: false,
            runId: 'r',
            score: 0,
            status: 'timeout',
            topicId: 't2',
          },
        ],
      });

      expect(metrics.passRate).toBe(0);
      expect(metrics.averageScore).toBe(0);
      expect(metrics.timeoutCases).toBe(2);
      expect(metrics.errorCases).toBe(0);
      expect(metrics.totalDuration).toBe(2_400_000);
    });
  });

  describe('evaluateAndFinalizeRun - pass@k metrics', () => {
    it('should include passAtK and passAllK in metrics when k > 1', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        run: { config: { k: 3 }, id: 'run-k3' },
        runTopics: [
          {
            evalResult: {
              // K>1: cost/tokens = per-case average, totalCost/totalTokens = cumulative
              cost: 0.03,
              duration: 3000,
              llmCalls: 6,
              passAllK: true,
              passAtK: true,
              rubricScores: [],
              steps: 9,
              threads: [
                { passed: true, score: 1, status: 'passed', threadId: 't1' },
                { passed: true, score: 1, status: 'passed', threadId: 't2' },
                { passed: true, score: 1, status: 'passed', threadId: 't3' },
              ],
              tokens: 150,
              toolCalls: 3,
              totalCost: 0.09,
              totalDuration: 9000,
              totalTokens: 450,
            },
            passed: true,
            runId: 'run-k3',
            score: 1,
            status: 'passed',
            topicId: 'topic-1',
          },
          {
            evalResult: {
              cost: 0.02,
              duration: 2000,
              llmCalls: 4,
              passAllK: false,
              passAtK: true,
              rubricScores: [],
              steps: 6,
              threads: [
                { passed: true, score: 1, status: 'passed', threadId: 't4' },
                { passed: false, score: 0, status: 'failed', threadId: 't5' },
                { passed: false, score: 0, status: 'failed', threadId: 't6' },
              ],
              tokens: 100,
              toolCalls: 2,
              totalCost: 0.06,
              totalDuration: 6000,
              totalTokens: 300,
            },
            passed: true,
            runId: 'run-k3',
            score: 1,
            status: 'passed',
            topicId: 'topic-2',
          },
          {
            evalResult: {
              cost: 0.01,
              duration: 1000,
              llmCalls: 2,
              passAllK: false,
              passAtK: false,
              rubricScores: [],
              steps: 3,
              threads: [
                { passed: false, score: 0, status: 'failed', threadId: 't7' },
                { passed: false, score: 0, status: 'failed', threadId: 't8' },
                { passed: false, score: 0, status: 'failed', threadId: 't9' },
              ],
              tokens: 50,
              toolCalls: 1,
              totalCost: 0.03,
              totalDuration: 3000,
              totalTokens: 150,
            },
            passed: false,
            runId: 'run-k3',
            score: 0,
            status: 'failed',
            topicId: 'topic-3',
          },
        ],
      });

      expect(metrics.totalCases).toBe(3);
      // pass@k: 2 of 3 have at least one thread passed
      expect(metrics.passAtK).toBeCloseTo(2 / 3);
      // pass^k: 1 of 3 have all threads passed
      expect(metrics.passAllK).toBeCloseTo(1 / 3);
      // cost/tokens = sum of per-case averages
      expect(metrics.cost).toBeCloseTo(0.06); // 0.03 + 0.02 + 0.01
      expect(metrics.tokens).toBe(300); // 150 + 100 + 50
      // totalCost/totalTokens/totalDuration = actual cumulative across all K threads
      expect(metrics.totalCost).toBeCloseTo(0.18); // 0.09 + 0.06 + 0.03
      expect(metrics.totalDuration).toBe(18_000); // 9000 + 6000 + 3000
      expect(metrics.totalTokens).toBe(900); // 450 + 300 + 150
      // steps/llmCalls/toolCalls = sum of per-case averages
      expect(metrics.steps).toBe(18); // 9 + 6 + 3
      expect(metrics.llmCalls).toBe(12); // 6 + 4 + 2
      expect(metrics.toolCalls).toBe(6); // 3 + 2 + 1
      // perCase = sum / totalCases (3 cases)
      expect(metrics.perCaseCost).toBeCloseTo(0.02); // 0.06 / 3
      expect(metrics.perCaseTokens).toBe(100); // 300 / 3
      expect(metrics.perCaseSteps).toBe(6); // 18 / 3
      expect(metrics.perCaseLlmCalls).toBe(4); // 12 / 3
      expect(metrics.perCaseToolCalls).toBe(2); // 6 / 3
    });

    it('should not include passAtK/passAllK in metrics when k = 1', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        run: { config: { k: 1 }, id: 'run-k1' },
        runTopics: [
          {
            evalResult: {
              rubricScores: [{ rubricId: 'r1', score: 1 }],
            },
            passed: true,
            runId: 'run-k1',
            score: 1,
            status: 'passed',
            topicId: 'topic-1',
          },
        ],
      });

      expect(metrics.passAtK).toBeUndefined();
      expect(metrics.passAllK).toBeUndefined();
    });

    it('should handle k > 1 with all cases having all threads passed', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        run: { config: { k: 2 }, id: 'run-k2' },
        runTopics: [
          {
            evalResult: {
              rubricScores: [],
              threads: [
                { passed: true, score: 1, status: 'passed', threadId: 't1' },
                { passed: true, score: 1, status: 'passed', threadId: 't2' },
              ],
            },
            passed: true,
            runId: 'run-k2',
            score: 1,
            status: 'passed',
            topicId: 'topic-1',
          },
          {
            evalResult: {
              rubricScores: [],
              threads: [
                { passed: true, score: 1, status: 'passed', threadId: 't3' },
                { passed: true, score: 1, status: 'passed', threadId: 't4' },
              ],
            },
            passed: true,
            runId: 'run-k2',
            score: 1,
            status: 'passed',
            topicId: 'topic-2',
          },
        ],
      });

      expect(metrics.passAtK).toBe(1); // 2/2
      expect(metrics.passAllK).toBe(1); // 2/2
    });
  });
});
