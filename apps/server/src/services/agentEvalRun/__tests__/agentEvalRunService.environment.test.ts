import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentEvalBenchmarkModel,
  AgentEvalEnvironmentModel,
  AgentEvalRunTopicModel,
} from '@/database/models/agentEval';
import {
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalTestCases,
  agents,
  topics,
} from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { mergeCaseEnvironment } from '@/server/services/agentEvalRun/caseEnvironment';

import { cleanupDB, serverDB, userId } from './_setup';

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: vi.fn() };
  }),
}));

const cleanup = async () => {
  await cleanupDB();
  await serverDB.delete(agentEvalEnvironments);
};

describe('mergeCaseEnvironment', () => {
  it('lays the case overrides over the shared environment, field by field', () => {
    const shared = {
      agent: { memory: { enabled: true }, plugins: ['gmail', 'notion'], systemRole: 'You help.' },
      mock: { services: ['gmail', 'notion'] },
      sessionDate: '2026-07-21',
      timezone: 'Asia/Shanghai',
    };
    expect(
      mergeCaseEnvironment(shared, {
        agent: { plugins: ['gmail'] },
        sessionDate: '2026-07-22',
      }),
    ).toEqual({
      agent: { memory: { enabled: true }, plugins: ['gmail'], systemRole: 'You help.' },
      mock: { services: ['gmail', 'notion'] },
      sessionDate: '2026-07-22',
      timezone: 'Asia/Shanghai',
    });
    expect(mergeCaseEnvironment(shared, undefined)).toEqual(shared);
    expect(mergeCaseEnvironment(undefined, { sessionDate: '2026-01-01' })).toEqual({
      sessionDate: '2026-01-01',
    });
  });
});

describe('shared environments', () => {
  beforeEach(cleanup);

  it('runs a case on its shared environment and lets the case tweak it', async () => {
    const environmentModel = new AgentEvalEnvironmentModel(serverDB, userId);
    const environment = await environmentModel.create({
      config: {
        agent: { plugins: ['shopify'], systemRole: 'You run a store.' },
        sessionDate: '2026-07-21',
      },
      identifier: 'store',
      name: 'Store clerk',
    });

    const benchmark = await new AgentEvalBenchmarkModel(serverDB, userId).create({
      identifier: 'bench',
      isSystem: false,
      name: 'Bench',
      rubrics: [],
    });
    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({ benchmarkId: benchmark.id, identifier: 'bench-v1', name: 'Bench v1', userId })
      .returning();
    const [shared] = await serverDB
      .insert(agentEvalTestCases)
      .values({
        content: { input: 'Check orders' },
        datasetId: dataset.id,
        environmentId: environment.id,
        sortOrder: 0,
        userId,
      })
      .returning();
    const [tweaked] = await serverDB
      .insert(agentEvalTestCases)
      .values({
        content: { environment: { sessionDate: '2026-07-22' }, input: 'Check returns' },
        datasetId: dataset.id,
        environmentId: environment.id,
        sortOrder: 1,
        userId,
      })
      .returning();

    const service = new AgentEvalRunService(serverDB, userId);
    const run = await service.createRun({
      config: { model: 'gpt-4.1-mini', provider: 'openai' },
      datasetId: dataset.id,
    });

    // Both cases got a hidden Agent built from the shared environment.
    const created = await serverDB
      .select()
      .from(agents)
      .where(and(eq(agents.userId, userId), eq(agents.virtual, true)));
    expect(created).toHaveLength(2);
    for (const agent of created) {
      expect(agent.systemRole).toBe('You run a store.');
      expect(agent.plugins).toEqual(['shopify']);
    }

    // The attempt environment carries the merged result: shared clock, or the case's own.
    const loaded = await service.loadTrajectoryData(run.id, tweaked.id);
    expect('environment' in loaded && loaded.environment?.sessionDate).toBe('2026-07-22');
    expect('environment' in loaded && loaded.environment?.agent?.systemRole).toBe(
      'You run a store.',
    );
    const loadedShared = await service.loadTrajectoryData(run.id, shared.id);
    expect('environment' in loadedShared && loadedShared.environment?.sessionDate).toBe(
      '2026-07-21',
    );

    // Each case still has its own topic and run topic.
    const runTopics = await new AgentEvalRunTopicModel(serverDB, userId).findByRunId(run.id);
    expect(runTopics).toHaveLength(2);
    const topicRows = await serverDB.select().from(topics).where(eq(topics.userId, userId));
    expect(topicRows).toHaveLength(2);
  });

  it('counts the cases pointing at each environment', async () => {
    const environmentModel = new AgentEvalEnvironmentModel(serverDB, userId);
    const environment = await environmentModel.create({ config: {}, name: 'Empty' });
    const benchmark = await new AgentEvalBenchmarkModel(serverDB, userId).create({
      identifier: 'bench',
      isSystem: false,
      name: 'Bench',
      rubrics: [],
    });
    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({ benchmarkId: benchmark.id, identifier: 'bench-v1', name: 'Bench v1', userId })
      .returning();
    await serverDB.insert(agentEvalTestCases).values([
      { content: { input: 'a' }, datasetId: dataset.id, environmentId: environment.id, userId },
      { content: { input: 'b' }, datasetId: dataset.id, environmentId: environment.id, userId },
      { content: { input: 'c' }, datasetId: dataset.id, userId },
    ]);

    const [row] = await environmentModel.query();
    expect(row.id).toBe(environment.id);
    expect(row.testCaseCount).toBe(2);

    // Deleting the environment detaches its cases instead of deleting them.
    await environmentModel.delete(environment.id);
    const cases = await serverDB.select().from(agentEvalTestCases);
    expect(cases).toHaveLength(3);
    expect(cases.every((item) => item.environmentId === null)).toBe(true);
  });
});
