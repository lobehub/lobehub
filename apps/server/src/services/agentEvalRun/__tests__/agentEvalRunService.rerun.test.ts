import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { topics } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { needsRerun } from '@/server/services/agentEvalRun/rerun';

import { cleanupDB, serverDB, setupMultiCaseRun, userId } from './_setup';

beforeEach(cleanupDB);

describe('needsRerun', () => {
  it('flags a case whose own status is not a verdict', () => {
    for (const status of ['error', 'timeout', 'judge_error']) {
      expect(needsRerun({ status })).toBe(true);
    }
    expect(needsRerun({ status: 'passed' })).toBe(false);
    expect(needsRerun({ status: 'failed' })).toBe(false);
  });

  it('flags a passed case when one of its attempts has no verdict', () => {
    expect(
      needsRerun({
        evalResult: { threads: [{ status: 'passed' }, { status: 'passed' }, { status: 'error' }] },
        status: 'passed',
      }),
    ).toBe(true);
    expect(
      needsRerun({
        evalResult: { threads: [{ status: 'passed' }, { status: 'failed' }] },
        status: 'failed',
      }),
    ).toBe(false);
  });
});

describe('AgentEvalRunService.rerunUnverifiedCases', () => {
  it('replaces the cases without a verdict, keeps the others and their history, and queues the run', async () => {
    const { run, cases } = await setupMultiCaseRun(
      [
        { assistantOutput: '42', expected: '42' },
        { assistantOutput: null },
        { assistantOutput: null },
        { assistantOutput: null },
      ],
      { datasetEvalMode: 'contains' },
    );
    const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
    const runModel = new AgentEvalRunModel(serverDB, userId);
    const service = new AgentEvalRunService(serverDB, userId);

    // Case 1: a clean pass.
    await service.recordTrajectoryCompletion({
      runId: run.id,
      telemetry: { completionReason: 'stop', duration: 1000 },
      testCaseId: cases[0].testCase.id,
    });
    // Case 2: the judge never graded it.
    const rt2 = await runTopicModel.findByRunAndTestCase(run.id, cases[1].testCase.id);
    await runTopicModel.updateByRunAndTopic(rt2!.runId, rt2!.topicId, {
      evalResult: { error: 'Judge failed: upstream timeout', rubricScores: [] },
      passed: undefined,
      score: undefined,
      status: 'judge_error',
    });
    // Case 3: passed on two attempts, but the third was blocked by the provider.
    const rt3 = await runTopicModel.findByRunAndTestCase(run.id, cases[2].testCase.id);
    await runTopicModel.updateByRunAndTopic(rt3!.runId, rt3!.topicId, {
      evalResult: {
        rubricScores: [],
        threads: [
          { passed: true, status: 'passed', threadId: 'a' },
          { passed: true, status: 'passed', threadId: 'b' },
          { error: 'Provider blocked the response', passed: false, status: 'error', threadId: 'c' },
        ],
      } as any,
      passed: true,
      score: 1,
      status: 'passed',
    });
    // Case 4: a clean fail.
    const rt4 = await runTopicModel.findByRunAndTestCase(run.id, cases[3].testCase.id);
    await runTopicModel.updateByRunAndTopic(rt4!.runId, rt4!.topicId, {
      evalResult: { rubricScores: [{ reason: 'missed', rubricId: 'judge', score: 0 }] },
      passed: false,
      score: 0,
      status: 'failed',
    });
    await runModel.update(run.id, { status: 'completed' });

    const result = await service.rerunUnverifiedCases(run.id);
    expect(result.rerunCount).toBe(2);

    const updatedRun = await runModel.findById(run.id);
    expect(updatedRun?.status).toBe('pending');

    const remaining = await runTopicModel.findByRunId(run.id);
    expect(remaining).toHaveLength(4);
    const byCase = new Map(remaining.map((topic) => [topic.testCaseId, topic]));
    expect(byCase.get(cases[0].testCase.id)?.status).toBe('passed');
    expect(byCase.get(cases[3].testCase.id)?.status).toBe('failed');
    expect(byCase.get(cases[1].testCase.id)?.status).toBe('pending');
    expect(byCase.get(cases[2].testCase.id)?.status).toBe('pending');
    // Fresh Topics for the rerun cases; the old ones stay for audit.
    expect(byCase.get(cases[1].testCase.id)?.topicId).not.toBe(cases[1].topic.id);
    expect(byCase.get(cases[2].testCase.id)?.topicId).not.toBe(cases[2].topic.id);
    const [oldTopic2] = await serverDB
      .select()
      .from(topics)
      .where(eq(topics.id, cases[1].topic.id));
    const [oldTopic3] = await serverDB
      .select()
      .from(topics)
      .where(eq(topics.id, cases[2].topic.id));
    expect(oldTopic2).toBeDefined();
    expect(oldTopic3).toBeDefined();

    // A queued run is not rerun again on top of itself.
    await expect(service.rerunUnverifiedCases(run.id)).rejects.toThrow(
      'Cannot rerun a pending run',
    );
  });

  it('leaves a run alone when every attempt has a verdict', async () => {
    const { run, cases } = await setupMultiCaseRun([{ assistantOutput: '42', expected: '42' }], {
      datasetEvalMode: 'contains',
    });
    const runModel = new AgentEvalRunModel(serverDB, userId);
    const service = new AgentEvalRunService(serverDB, userId);
    await service.recordTrajectoryCompletion({
      runId: run.id,
      telemetry: { completionReason: 'stop', duration: 1000 },
      testCaseId: cases[0].testCase.id,
    });
    await runModel.update(run.id, { status: 'completed' });

    const result = await service.rerunUnverifiedCases(run.id);
    expect(result.rerunCount).toBe(0);
    expect((await runModel.findById(run.id))?.status).toBe('completed');
  });
});
