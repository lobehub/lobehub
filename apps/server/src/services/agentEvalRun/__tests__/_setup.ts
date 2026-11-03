import { getTestDB } from '@/database/core/getTestDB';
import {
  AgentEvalBenchmarkModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
} from '@/database/models/agentEval';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  messages,
  threads,
  topics,
  users,
} from '@/database/schemas';

export const serverDB = await getTestDB();

export const userId = 'eval-service-test-user';

export async function cleanupDB() {
  await serverDB.delete(messages);
  await serverDB.delete(threads);
  await serverDB.delete(agentEvalRunTopics);
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  await serverDB.insert(users).values({ id: userId });
}

/**
 * Helper: set up a full eval chain (benchmark → dataset → testCase → run → topic → runTopic → message)
 */
export async function setupEvalChain(opts: {
  assistantOutput?: string | null;
  benchmarkRubrics?: any[];
  datasetEvalConfig?: any;
  datasetEvalMode?: string | null;
  expected?: string;
  passThreshold?: number;
  totalCases?: number;
}) {
  const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
  const benchmark = await benchmarkModel.create({
    identifier: 'test-benchmark',
    isSystem: false,
    name: 'Test Benchmark',
    rubrics: opts.benchmarkRubrics ?? [],
  });

  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId: benchmark.id,
      evalConfig: opts.datasetEvalConfig,
      evalMode: opts.datasetEvalMode as any,
      identifier: 'test-dataset',
      name: 'Test Dataset',
      userId,
    })
    .returning();

  const [testCase] = await serverDB
    .insert(agentEvalTestCases)
    .values({
      userId,
      content: { expected: opts.expected ?? '42', input: 'What is 6*7?' },
      datasetId: dataset.id,
      sortOrder: 1,
    })
    .returning();

  const runModel = new AgentEvalRunModel(serverDB, userId);
  const run = await runModel.create({ datasetId: dataset.id, name: 'Test Run' });

  // Set totalCases in metrics so progress tracking works
  if (opts.totalCases !== undefined) {
    await runModel.update(run.id, {
      config: opts.passThreshold !== undefined ? { passThreshold: opts.passThreshold } : undefined,
      metrics: {
        averageScore: 0,
        failedCases: 0,
        passRate: 0,
        passedCases: 0,
        totalCases: opts.totalCases,
      },
    });
  }

  const [topic] = await serverDB
    .insert(topics)
    .values({ mode: 'test', title: 'Eval Topic', trigger: 'eval', userId })
    .returning();

  const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
  await runTopicModel.batchCreate([{ runId: run.id, testCaseId: testCase.id, topicId: topic.id }]);

  // Create assistant message if specified
  if (opts.assistantOutput !== undefined && opts.assistantOutput !== null) {
    await serverDB.insert(messages).values({
      content: opts.assistantOutput,
      role: 'assistant',
      topicId: topic.id,
      userId,
    });
  }

  return { benchmark, dataset, run, testCase, topic };
}

/**
 * Helper: set up multiple test cases for a single run
 */
export async function setupMultiCaseRun(
  cases: Array<{
    assistantOutput?: string | null;
    expected?: string;
  }>,
  opts?: {
    benchmarkRubrics?: any[];
    datasetEvalMode?: string | null;
  },
) {
  const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
  const benchmark = await benchmarkModel.create({
    identifier: 'test-benchmark',
    isSystem: false,
    name: 'Test Benchmark',
    rubrics: opts?.benchmarkRubrics ?? [],
  });

  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId: benchmark.id,
      evalMode: (opts?.datasetEvalMode ?? null) as any,
      identifier: 'test-dataset',
      name: 'Test Dataset',
      userId,
    })
    .returning();

  const runModel = new AgentEvalRunModel(serverDB, userId);
  const run = await runModel.create({ datasetId: dataset.id, name: 'Test Run' });
  await runModel.update(run.id, {
    metrics: {
      averageScore: 0,
      failedCases: 0,
      passRate: 0,
      passedCases: 0,
      totalCases: cases.length,
    },
  });

  const result: Array<{ testCase: any; topic: any }> = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const [testCase] = await serverDB
      .insert(agentEvalTestCases)
      .values({
        userId,
        content: { expected: c.expected ?? '42', input: `Q${i}` },
        datasetId: dataset.id,
        sortOrder: i + 1,
      })
      .returning();

    const [topic] = await serverDB
      .insert(topics)
      .values({ mode: 'test', title: `Topic ${i}`, trigger: 'eval', userId })
      .returning();

    const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
    await runTopicModel.batchCreate([
      { runId: run.id, testCaseId: testCase.id, topicId: topic.id },
    ]);

    if (c.assistantOutput !== undefined && c.assistantOutput !== null) {
      await serverDB.insert(messages).values({
        content: c.assistantOutput,
        role: 'assistant',
        topicId: topic.id,
        userId,
      });
    }

    result.push({ testCase, topic });
  }

  return { benchmark, cases: result, dataset, run };
}
