import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { agentEvalRuns } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { cleanupDB, serverDB, setupEvalChain, userId } from './_setup';

const generateObject = vi.fn();
vi.mock('@/server/modules/AgentRuntime/llmRelay/oneShot', () => ({
  initModelRuntimeForRequest: vi.fn(async () => ({ generateObject })),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: vi.fn() };
  }),
}));

const RULES = [
  'Must: Report both order IDs (paper_order_001, paper_order_002).',
  'Must not: Say the stop order filled.',
].join('\n');

/** A completed run whose one case was graded "passed" at 0.9 by the old judge. */
const setupJudgedRun = async (status: 'error' | 'passed' = 'passed') => {
  const chain = await setupEvalChain({
    assistantOutput: 'Placed paper_order_001 and paper_order_002; the stop filled right away.',
    datasetEvalConfig: { judgePrompt: RULES, model: 'judge-model', provider: 'openai' },
    datasetEvalMode: 'rule-checklist',
    totalCases: 1,
  });
  const runModel = new AgentEvalRunModel(serverDB, userId);
  await runModel.update(chain.run.id, {
    metrics: {
      averageScore: 0.9,
      duration: 1234,
      failedCases: 0,
      passRate: 1,
      passedCases: 1,
      totalCases: 1,
    },
    status: 'completed',
  });
  await new AgentEvalRunTopicModel(serverDB, userId).updateByRunAndTopic(
    chain.run.id,
    chain.topic.id,
    {
      evalResult: {
        completionReason: 'completed',
        cost: 0.01,
        rubricScores: [{ reason: 'old verdict', rubricId: 'eval-mode-llm-rubric', score: 0.9 }],
        tokens: 100,
      },
      passed: status === 'passed',
      score: status === 'passed' ? 0.9 : 0,
      status,
    },
  );
  return chain;
};

beforeEach(async () => {
  await cleanupDB();
  generateObject.mockReset();
  generateObject.mockResolvedValue({
    rules: [
      { index: 1, reason: 'Both ids are in the reply.', verdict: 'satisfied' },
      { index: 2, reason: 'The reply says the stop filled.', verdict: 'violated' },
    ],
    summary: 'One rule broken.',
  });
});

describe('AgentEvalRunService.rejudgeRun', () => {
  it('grades the recorded attempt again with the current rules and rebuilds the metrics', async () => {
    const { run, topic } = await setupJudgedRun();

    const result = await new AgentEvalRunService(serverDB, userId).rejudgeRun(run.id);

    expect(result).toEqual({ failedCases: 1, judgeErrorCases: 0, passedCases: 0, rejudged: 1 });
    expect(generateObject).toHaveBeenCalledTimes(1);
    const prompt = generateObject.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain('[Rules]\n1. Must: Report both order IDs');
    expect(prompt).toContain('[Output]\nPlaced paper_order_001');

    const runTopic = await new AgentEvalRunTopicModel(serverDB, userId).findByRunAndTestCase(
      run.id,
      (await serverDB.query.agentEvalRunTopics.findFirst())!.testCaseId,
    );
    expect(runTopic?.status).toBe('failed');
    expect(runTopic?.score).toBe(0.5);
    expect(runTopic?.evalResult?.rubricScores?.[0]).toMatchObject({
      rubricId: 'eval-mode-rule-checklist',
      score: 0.5,
      verdicts: [
        {
          rule: 'Must: Report both order IDs (paper_order_001, paper_order_002).',
          verdict: 'satisfied',
        },
        { rule: 'Must not: Say the stop order filled.', verdict: 'violated' },
      ],
    });
    // Telemetry of the original execution is kept.
    expect(runTopic?.evalResult?.cost).toBe(0.01);
    expect(runTopic?.topicId).toBe(topic.id);

    const [updated] = await serverDB
      .select()
      .from(agentEvalRuns)
      .where(eq(agentEvalRuns.id, run.id));
    expect(updated.metrics).toMatchObject({
      duration: 1234,
      failedCases: 1,
      passRate: 0,
      passedCases: 0,
      totalCases: 1,
    });
    expect(updated.status).toBe('completed');
  });

  it('leaves cases without a verdict alone', async () => {
    const { run } = await setupJudgedRun('error');

    const result = await new AgentEvalRunService(serverDB, userId).rejudgeRun(run.id);

    expect(result).toEqual({ failedCases: 0, judgeErrorCases: 0, passedCases: 0, rejudged: 0 });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('refuses a run that is still executing', async () => {
    const { run } = await setupJudgedRun();
    await new AgentEvalRunModel(serverDB, userId).update(run.id, { status: 'running' });

    await expect(new AgentEvalRunService(serverDB, userId).rejudgeRun(run.id)).rejects.toThrow(
      'Cannot re-judge a running run',
    );
  });
});
