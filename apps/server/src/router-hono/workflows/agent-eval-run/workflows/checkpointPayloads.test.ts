import { beforeEach, describe, expect, it, vi } from 'vitest';

import { serializeStepResult } from '@/server/workflows/testing/stepContext';

import { executeTestCaseHandler } from './executeTestCase';
import { finalizeRunHandler } from './finalizeRun';
import { runBenchmarkHandler } from './runBenchmark';

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  cases: vi.fn(),
  finalize: vi.fn(),
  findFull: vi.fn(),
  findSummary: vi.fn(),
  topics: vi.fn(),
  triggerTrajectory: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/agentEval', () => ({
  AgentEvalRunModel: class {
    findById = mocks.findFull;
    findSummaryById = mocks.findSummary;
    finalize = mocks.finalize;
    update = mocks.update;
  },
  AgentEvalTestCaseModel: class {
    findByDatasetId = mocks.cases;
  },
  AgentEvalRunTopicModel: class {
    findByRunId = mocks.topics;
  },
}));
vi.mock('@/server/services/agentEvalRun', () => ({
  AgentEvalRunService: class {
    evaluateAndFinalizeRun = mocks.aggregate;
  },
}));
vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: {
    filterTestCasesNeedingExecution: async (
      _: unknown,
      { testCaseIds }: { testCaseIds: string[] },
    ) => testCaseIds,
    triggerPaginateTestCases: vi.fn(),
    triggerRunAgentTrajectory: mocks.triggerTrajectory,
  },
}));
vi.mock('@/server/workflows/agentEvalRun/utils', () => ({
  resolveAgentEvalRunWorkspace: vi.fn().mockResolvedValue(undefined),
}));

const bulkyRun = (caseCount: number) => ({
  config: {
    k: 3,
    connectorSnapshots: Object.fromEntries(
      Array.from({ length: caseCount }, (_, index) => [
        `case-${index}`,
        { manifest: 'large frozen original contract '.repeat(2000) },
      ]),
    ),
  },
  datasetId: 'dataset',
  id: 'run',
  metrics: { totalCases: 50 },
  startedAt: new Date('2026-11-04T12:00:00Z'),
  status: 'idle',
});
const checkpointContext = (legacy: Record<string, unknown> = {}) => {
  const outputs: Record<string, unknown> = {};
  const context = {
    requestPayload: { runId: 'run', testCaseId: 'case-0', userId: 'owner' },
    run: vi.fn(async (name: string, callback: () => Promise<unknown>) => {
      const value = Object.hasOwn(legacy, name) ? legacy[name] : await callback();
      outputs[name] = serializeStepResult(value);
      return outputs[name];
    }),
  };
  return { context: context as any, outputs };
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findFull.mockRejectedValue(new Error('Workflow must not read a full run'));
  mocks.findSummary.mockResolvedValue(bulkyRun(50));
  mocks.cases.mockResolvedValue([
    { content: { input: 'Private case body'.repeat(1000) }, id: 'case-0' },
  ]);
  mocks.update.mockResolvedValue(bulkyRun(50));
  mocks.finalize.mockResolvedValue(bulkyRun(50));
  mocks.topics.mockResolvedValue([
    {
      passed: true,
      runId: 'run',
      score: 1,
      status: 'passed',
      topicId: 'topic',
      testCase: { content: 'Huge body'.repeat(1000) },
      topic: { metadata: 'Unneeded joined topic' },
    },
  ]);
  mocks.aggregate.mockResolvedValue({ averageScore: 1, passedCases: 1, totalCases: 1 });
});

describe('Evaluation workflow checkpoint boundaries', () => {
  it('keeps execute-test-case status/k output independent of unrelated case snapshots', async () => {
    const sizes: number[] = [];
    for (const count of [1, 50]) {
      mocks.findSummary.mockResolvedValue(bulkyRun(count));
      const { context, outputs } = checkpointContext();
      expect(await executeTestCaseHandler(context)).toMatchObject({ k: 3, success: true });
      expect(outputs['agent-eval-run:get-run']).toEqual({ config: { k: 3 }, status: 'idle' });
      sizes.push(Buffer.byteLength(JSON.stringify(outputs)));
    }
    expect(sizes[0]).toBe(sizes[1]);
    expect(mocks.findFull).not.toHaveBeenCalled();
  });

  it('checkpoints selected case IDs and discards unused update return rows', async () => {
    const { context, outputs } = checkpointContext();
    await runBenchmarkHandler(context);
    expect(outputs['agent-eval-run:get-test-cases']).toEqual(['case-0']);
    expect(outputs['agent-eval-run:update-status']).toBeUndefined();
    expect(JSON.stringify(outputs)).not.toMatch(
      /connectorSnapshots|Private case body|large frozen/,
    );
    expect(Buffer.byteLength(JSON.stringify(outputs))).toBeLessThan(500);
    expect(mocks.update).toHaveBeenCalledWith(
      'run',
      expect.objectContaining({ metrics: expect.objectContaining({ totalCases: 1 }) }),
    );
  });

  it('counts the cases a rerun keeps as soon as the run restarts, not 0 done', async () => {
    mocks.topics.mockResolvedValue([
      {
        evalResult: { completionReason: 'stop', cost: 0.01 },
        passed: true,
        runId: 'run',
        status: 'passed',
        topicId: 'kept',
      },
      { evalResult: null, passed: null, runId: 'run', status: 'pending', topicId: 'rerun' },
    ]);
    const { context } = checkpointContext();
    await runBenchmarkHandler(context);
    expect(mocks.update).toHaveBeenCalledWith(
      'run',
      expect.objectContaining({
        metrics: expect.objectContaining({ completedCases: 1, passedCases: 1, totalCases: 1 }),
        status: 'running',
      }),
    );
  });

  it('continues replay of an older full run and full case-object checkpoint', async () => {
    const { context } = checkpointContext({
      'agent-eval-run:get-run': bulkyRun(50),
      'agent-eval-run:get-test-cases': [
        { id: 'legacy-case', content: { input: 'Old checkpoint content' } },
      ],
    });
    expect(await runBenchmarkHandler(context)).toMatchObject({ success: true, totalTestCases: 1 });
    expect(mocks.findSummary).not.toHaveBeenCalled();
    expect(mocks.cases).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      'run',
      expect.objectContaining({ metrics: expect.objectContaining({ totalCases: 1 }) }),
    );
  });

  it('stores only aggregate topic fields and a boolean finalization result', async () => {
    const { context, outputs } = checkpointContext();
    await finalizeRunHandler(context);
    expect(outputs['agent-eval-run:update-run']).toBe(true);
    expect(JSON.stringify(outputs)).not.toMatch(
      /connectorSnapshots|Huge body|Unneeded joined topic|large frozen/,
    );
    expect(outputs['agent-eval-run:get-run-topics']).toEqual([
      { passed: true, runId: 'run', score: 1, status: 'passed', topicId: 'topic' },
    ]);
    expect(mocks.finalize).toHaveBeenCalledWith('run', expect.anything(), {
      startedAt: '2026-11-04T12:00:00.000Z',
    });
  });

  it.each([
    ['cancelled', false],
    ['legacy row', { id: 'legacy-finalized-run', config: bulkyRun(50).config }],
  ])('accepts a %s finalization checkpoint', async (_, finalized) => {
    const { context } = checkpointContext({ 'agent-eval-run:update-run': finalized });
    expect(await finalizeRunHandler(context)).toMatchObject(
      finalized ? { success: true } : { cancelled: true },
    );
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('finalizes with metrics from the verdicts as they are when it finalizes, not the earlier checkpoint', async () => {
    const stale = [
      { passed: false, runId: 'run', score: 0, status: 'failed', topicId: 'a' },
      { passed: null, runId: 'run', score: null, status: 'running', topicId: 'b' },
    ];
    const current = [
      { passed: false, runId: 'run', score: 0, status: 'failed', topicId: 'a' },
      { passed: true, runId: 'run', score: 1, status: 'passed', topicId: 'b' },
    ];
    const { context } = checkpointContext({ 'agent-eval-run:get-run-topics': stale });
    mocks.topics.mockResolvedValue(current);
    mocks.aggregate.mockImplementation(async ({ runTopics }) => ({
      averageScore: 0.5,
      passedCases: runTopics.filter((topic: { status: string }) => topic.status === 'passed')
        .length,
      totalCases: runTopics.length,
    }));
    await finalizeRunHandler(context);
    expect(mocks.finalize).toHaveBeenCalledWith(
      'run',
      { metrics: expect.objectContaining({ passedCases: 1, totalCases: 2 }), status: 'completed' },
      expect.anything(),
    );
  });
});
