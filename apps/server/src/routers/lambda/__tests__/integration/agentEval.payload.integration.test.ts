// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  topics,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import type { EvalRunConfig } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalExperimentModel, AgentEvalRunModel } from '@/database/models/agentEval';

import { agentEvalRouter } from '../../agentEval';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => serverDB),
}));

describe('Agent Eval UI payloads', () => {
  let userId: string;
  let otherUserId: string;
  let datasetId: string;
  let experimentId: string;
  let runId: string;
  let frozenConfig: EvalRunConfig;
  const manifestMarker = 'frozen-contract-not-for-ui';
  const settings: EvalRunConfig = {
    agentSnapshot: { model: 'test-model', plugins: ['notion'], provider: 'test-provider' },
    caseSelection: { mode: 'all' },
    caseVersion: 'frozen-case-version',
    chatConfig: { enableReasoning: true },
    executionMode: 'internal',
    k: 3,
    maxSteps: 20,
    model: 'test-model',
    params: { temperature: 0.3 },
    provider: 'test-provider',
    timeout: 300_000,
  };

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = await createTestUser(serverDB);
    otherUserId = await createTestUser(serverDB);
    const [benchmark] = await serverDB
      .insert(agentEvalBenchmarks)
      .values({
        identifier: 'payload-benchmark',
        isSystem: false,
        name: 'Payload',
        rubrics: [],
        userId,
      })
      .returning();
    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({ benchmarkId: benchmark.id, identifier: 'payload-cases', name: 'Cases', userId })
      .returning();
    datasetId = dataset.id;
    const experiment = await new AgentEvalExperimentModel(serverDB, userId).create({
      benchmarkIds: [benchmark.id],
      name: 'Payload experiment',
    });
    experimentId = experiment.id;

    const cases = await serverDB
      .insert(agentEvalTestCases)
      .values(
        Array.from({ length: 50 }, (_, index) => ({
          content: { input: `Question ${index + 1}` },
          datasetId,
          userId,
        })),
      )
      .returning();
    frozenConfig = {
      ...settings,
      connectorSnapshots: Object.fromEntries(
        cases.map((testCase) => [
          testCase.id,
          {
            notion: {
              connectorId: 'frozen-connection',
              datasetId,
              fingerprint: `frozen-${testCase.id}`,
              manifest: {
                api: [
                  {
                    description: `${manifestMarker}:${'x'.repeat(32_768)}`,
                    name: 'search',
                    parameters: { properties: { query: { type: 'string' } }, type: 'object' },
                  },
                ],
                identifier: 'notion',
                meta: { title: 'Notion' },
                type: 'mcp',
              },
              transport: 'mcp',
            },
          },
        ]),
      ),
    };
    const [run] = await serverDB
      .insert(agentEvalRuns)
      .values({ config: frozenConfig, datasetId, experimentId, name: 'Read payload', userId })
      .returning();
    runId = run.id;
    const runTopics = await serverDB
      .insert(topics)
      .values(cases.map((_, index) => ({ title: `Case ${index + 1}`, userId })))
      .returning();
    await serverDB.insert(agentEvalRunTopics).values(
      cases.map((testCase, index) => ({
        runId,
        status: 'pending',
        testCaseId: testCase.id,
        topicId: runTopics[index].id,
        userId,
      })),
    );
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, otherUserId);
    await cleanupTestUser(serverDB, userId);
  });

  it('keeps fifty frozen contracts in storage while omitting them from run and experiment reads', async () => {
    const caller = agentEvalRouter.createCaller(createTestContext(userId));
    const [list, detail, results, progress, experiments, experiment] = await Promise.all([
      caller.listRuns({ datasetId }),
      caller.getRunDetails({ id: runId }),
      caller.getRunResults({ id: runId }),
      caller.getRunProgress({ id: runId }),
      caller.listExperiments(),
      caller.getExperiment({ id: experimentId }),
    ]);

    expect(list.data).toHaveLength(1);
    expect(results.results).toHaveLength(50);
    expect(detail.topics).toHaveLength(50);
    expect(list.data[0].config).toEqual(settings);
    expect(detail.config).toEqual(settings);
    expect(experiments.data[0].recentRuns?.[0].config).toEqual(settings);
    expect(experiment.data.runs[0].config).toEqual(settings);

    for (const response of [list, detail, results, progress, experiments, experiment]) {
      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain('connectorSnapshots');
      expect(serialized).not.toContain(manifestMarker);
      // Detail includes all fifty case results; the frozen run alone exceeds 1.5 MB.
      expect(Buffer.byteLength(serialized)).toBeLessThan(100_000);
    }

    const stored = await new AgentEvalRunModel(serverDB, userId).findById(runId);
    expect(stored?.config).toEqual(frozenConfig);
    expect(Object.keys(stored!.config!.connectorSnapshots!)).toHaveLength(50);
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeGreaterThan(1_500_000);
  });

  it('omits frozen contracts from benchmark recent-run previews', async () => {
    const caller = agentEvalRouter.createCaller(createTestContext(userId));
    const benchmarks = await caller.listBenchmarks({ includeSystem: false });

    expect(benchmarks).toHaveLength(1);
    expect(benchmarks[0].recentRuns).toHaveLength(1);
    const run = benchmarks[0].recentRuns[0];
    expect(!!run.config?.connectorSnapshots).toBe(false);
    expect(run.config).toEqual(settings);
    expect(run.id).toBe(runId);
    expect(benchmarks[0]).toMatchObject({ datasetCount: 1, runCount: 1, testCaseCount: 50 });
    expect(JSON.stringify(benchmarks)).not.toContain(manifestMarker);
    expect(Buffer.byteLength(JSON.stringify(benchmarks))).toBeLessThan(10_000);

    const stored = await new AgentEvalRunModel(serverDB, userId).findById(runId);
    expect(stored?.config).toEqual(frozenConfig);
  });

  it('preserves server-owned frozen settings when a client edits the returned summary config', async () => {
    const caller = agentEvalRouter.createCaller(createTestContext(userId));
    const detail = await caller.getRunDetails({ id: runId });
    await caller.updateRun({
      config: { k: detail.config!.k!, maxSteps: 25, timeout: detail.config!.timeout! },
      id: runId,
    });

    const [stored] = await serverDB.select().from(agentEvalRuns).where(eq(agentEvalRuns.id, runId));
    expect(stored.config).toEqual({ ...frozenConfig, maxSteps: 25 });
  });

  it('keeps run and experiment summaries scoped to their owner', async () => {
    const otherCaller = agentEvalRouter.createCaller(createTestContext(otherUserId));
    expect((await otherCaller.listRuns({ datasetId })).data).toEqual([]);
    expect((await otherCaller.listExperiments()).data).toEqual([]);
    expect(await otherCaller.listBenchmarks({ includeSystem: false })).toEqual([]);
    await Promise.all([
      expect(otherCaller.getRunDetails({ id: runId })).rejects.toMatchObject({ code: 'NOT_FOUND' }),
      expect(otherCaller.getRunResults({ id: runId })).rejects.toMatchObject({ code: 'NOT_FOUND' }),
      expect(otherCaller.getRunProgress({ id: runId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      }),
      expect(otherCaller.getExperiment({ id: experimentId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      }),
    ]);
  });
});
