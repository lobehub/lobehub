import type { EvalThreadResult } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  topics,
  users,
} from '../../../schemas';
import { AgentEvalExperimentModel } from '../experiment';
import { AgentEvalRunModel } from '../run';
import { AgentEvalRunTopicModel } from '../runTopic';

const db = await getTestDB();
const userId = 'run-evidence-test-user';
const runModel = new AgentEvalRunModel(db, userId);
const experiments = new AgentEvalExperimentModel(db, userId);
const passed = (id: string): EvalThreadResult => ({ passed: true, status: 'passed', threadId: id });

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

const setup = async (attempts?: EvalThreadResult[], skipTopic = false) => {
  const [benchmark] = await db
    .insert(agentEvalBenchmarks)
    .values({
      identifier: 'evidence',
      isSystem: false,
      name: 'Evidence',
      rubrics: [],
      userId,
    })
    .returning();
  const [dataset] = await db
    .insert(agentEvalDatasets)
    .values({
      benchmarkId: benchmark.id,
      identifier: 'evidence',
      name: 'Evidence',
      userId,
    })
    .returning();
  const experiment = await experiments.create({ benchmarkIds: [benchmark.id], name: 'Evidence' });
  // This is the historical bug: summary metrics claim a complete, error-free
  // run even when its saved attempts contain an infrastructure failure.
  const metrics = {
    averageScore: 1,
    completedCases: 1,
    errorCases: 0,
    failedCases: 0,
    passAllK: 1,
    passRate: 1,
    passedCases: 1,
    totalCases: 1,
  };
  const run = await runModel.create({
    config: { k: 3 },
    datasetId: dataset.id,
    experimentId: experiment.id,
    metrics,
    status: 'completed',
  });
  if (!skipTopic) {
    const [testCase] = await db
      .insert(agentEvalTestCases)
      .values({ content: { input: 'Q' }, datasetId: dataset.id, userId })
      .returning();
    const [topic] = await db.insert(topics).values({ title: 'Evidence', userId }).returning();
    await new AgentEvalRunTopicModel(db, userId).batchCreate([
      {
        evalResult: { passAtK: true, passAllK: false, threads: attempts },
        passed: true,
        runId: run.id,
        score: 1,
        status: 'passed',
        testCaseId: testCase.id,
        topicId: topic.id,
      },
    ]);
  }
  return { experiment, metrics, run };
};

describe('read-time evidence eligibility', () => {
  it.each([
    { name: 'single attempt without a verdict', passed: null, evalResult: {} },
    {
      name: 'legacy Judge failure on a passed row',
      passed: true,
      evalResult: { errorPhase: 'judge' as const },
    },
  ])('$name stays unverified', async ({ passed, evalResult }) => {
    const { run } = await setup();
    await runModel.update(run.id, { config: { k: 1 } });
    await db
      .update(agentEvalRunTopics)
      .set({ evalResult, passed })
      .where(eq(agentEvalRunTopics.runId, run.id));
    expect((await runModel.findById(run.id))?.hasUnverifiedAttempts).toBe(true);
  });

  const scenarios: Array<{
    attempts?: EvalThreadResult[];
    expected: boolean;
    name: string;
    skipTopic?: boolean;
  }> = [
    {
      name: 'legacy mixed execution error',
      expected: true,
      attempts: [passed('1'), passed('2'), { passed: false, status: 'error', threadId: '3' }],
    },
    {
      name: 'legacy no-output model-failure label',
      expected: true,
      attempts: [
        passed('1'),
        passed('2'),
        { error: 'No assistant output', passed: false, status: 'failed', threadId: '3' },
      ],
    },
    { name: 'missing attempt', expected: true, attempts: [passed('1'), passed('2')] },
    { name: 'missing run topic', expected: true, skipTopic: true },
    {
      name: 'missing boolean verdict',
      expected: true,
      attempts: [passed('1'), passed('2'), { status: 'passed', threadId: '3' }],
    },
    {
      name: 'complete valid sample including a model failure',
      expected: false,
      attempts: [
        passed('1'),
        passed('2'),
        {
          error: 'Reached the step limit (20) without a final answer',
          passed: false,
          status: 'failed',
          threadId: '3',
        },
      ],
    },
  ];

  it.each(scenarios)(
    '$name is consistently exposed without rewriting history',
    async ({ attempts, expected, skipTopic }) => {
      const { experiment, metrics, run } = await setup(attempts, skipTopic);
      const single = await runModel.findById(run.id);
      const listed = (await runModel.query()).find((item) => item.id === run.id);
      const detail = await experiments.findById(experiment.id);
      const recent = (await experiments.query())
        .find((item) => item.id === experiment.id)
        ?.recentRuns?.find((item) => item.id === run.id);
      for (const result of [single, listed, detail?.runs?.[0], recent]) {
        expect(result).toBeDefined();
        expect(result?.hasUnverifiedAttempts).toBe(expected);
      }
      const [stored] = await db.select().from(agentEvalRuns).where(eq(agentEvalRuns.id, run.id));
      expect(stored.metrics).toEqual(metrics);
      expect(stored).not.toHaveProperty('hasUnverifiedAttempts');
    },
  );
});
