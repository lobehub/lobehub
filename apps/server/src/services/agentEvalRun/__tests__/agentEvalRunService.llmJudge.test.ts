// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { agentEvalDatasets, agentEvalTestCases, messages, topics } from '@/database/schemas';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { cleanupDB, serverDB, userId } from './_setup';

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

const generateObject = vi.fn();

beforeEach(async () => {
  await cleanupDB();
  generateObject.mockReset().mockResolvedValue({ reason: 'treats the user as Arvin', score: 0.9 });
  vi.mocked(initModelRuntimeFromDB).mockReset();
  vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ generateObject } as any);
});

const setup = async (evalMode: string, judge?: { model: string; provider: string }) => {
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({ identifier: 'ds', name: 'ds', userId })
    .returning();
  const [testCase] = await serverDB
    .insert(agentEvalTestCases)
    .values({
      content: { input: '你不知道我是谁吗' },
      datasetId: dataset.id,
      evalConfig: { criteria: 'The user is Arvin; never call the user 宋清扬.' },
      evalMode: evalMode as any,
      userId,
    })
    .returning();
  const run = await new AgentEvalRunModel(serverDB, userId).create({
    config: judge ? { judgeModel: judge.model, judgeProvider: judge.provider } : undefined,
    datasetId: dataset.id,
  });
  const [topic] = await serverDB
    .insert(topics)
    .values({ mode: 'test', title: 't', trigger: 'eval', userId })
    .returning();
  await new AgentEvalRunTopicModel(serverDB, userId).batchCreate([
    { runId: run.id, testCaseId: testCase.id, topicId: topic.id },
  ]);
  await serverDB
    .insert(messages)
    .values({ content: 'You are Arvin.', role: 'assistant', topicId: topic.id, userId });

  return { run, testCase };
};

describe('AgentEvalRunService llm-rubric judging', () => {
  it('scores an llm-rubric case through the configured judge model', async () => {
    const { run, testCase } = await setup('llm-rubric', {
      model: 'claude-haiku-4-5',
      provider: 'anthropic',
    });

    await new AgentEvalRunService(serverDB, userId).recordTrajectoryCompletion({
      runId: run.id,
      telemetry: { completionReason: 'stop', duration: 10 },
      testCaseId: testCase.id,
    });

    const runTopic = await new AgentEvalRunTopicModel(serverDB, userId).findByRunAndTestCase(
      run.id,
      testCase.id,
    );

    // Before the judge was wired in, every llm-rubric case scored 0 with
    // "LLM judge not available".
    expect(runTopic?.score).toBeCloseTo(0.9);
    expect(runTopic?.status).toBe('passed');
    expect(runTopic?.evalResult?.rubricScores?.[0]?.reason).toBe('treats the user as Arvin');
    expect(initModelRuntimeFromDB).toHaveBeenCalledWith(serverDB, userId, 'anthropic', undefined);
    expect(generateObject.mock.calls[0][0].model).toBe('claude-haiku-4-5');
  });

  it('does not build a judge for rubrics that need no LLM', async () => {
    const { run, testCase } = await setup('contains');

    await new AgentEvalRunService(serverDB, userId).recordTrajectoryCompletion({
      runId: run.id,
      telemetry: { completionReason: 'stop', duration: 10 },
      testCaseId: testCase.id,
    });

    expect(initModelRuntimeFromDB).not.toHaveBeenCalled();
  });
});
