import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentEvalBenchmarkModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import {
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalTestCases,
  agents,
  topics,
} from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { CASE_AGENT_MODEL_REQUIRED } from '@/server/services/agentEvalRun/caseAgent';

import { cleanupDB, serverDB, userId } from './_setup';

beforeEach(cleanupDB);

const createDataset = async (withAgent = false) => {
  const benchmark = await new AgentEvalBenchmarkModel(serverDB, userId).create({
    identifier: 'atomic-run',
    name: 'Atomic run',
    isSystem: false,
    rubrics: [],
  });
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({ benchmarkId: benchmark.id, identifier: 'atomic-dataset', name: 'Cases', userId })
    .returning();
  const [testCase] = await serverDB
    .insert(agentEvalTestCases)
    .values({
      content: {
        input: 'A question',
        ...(withAgent && { environment: { agent: { systemRole: 'A case agent' } } }),
      },
      datasetId: dataset.id,
      metadata: { caseId: 'question-1' },
      userId,
    })
    .returning();
  return { dataset, testCase };
};

describe('run creation persistence', () => {
  it('rolls back a failed case setup so the same id can be retried with corrected config', async () => {
    const { dataset } = await createDataset(true);
    const service = new AgentEvalRunService(serverDB, userId);
    const params = { datasetId: dataset.id, id: 'run_atomic01' };

    await expect(service.createRun(params)).rejects.toThrow(CASE_AGENT_MODEL_REQUIRED);
    expect(await serverDB.select().from(agentEvalRuns)).toHaveLength(0);
    expect(await serverDB.select().from(topics)).toHaveLength(0);
    expect(await serverDB.select().from(agents).where(eq(agents.virtual, true))).toHaveLength(0);

    const corrected = { ...params, config: { model: 'test-model', provider: 'openai' } };
    const run = await service.createRun(corrected);
    expect(run.id).toBe(params.id);
    expect(await new AgentEvalRunTopicModel(serverDB, userId).findByRunId(run.id)).toHaveLength(1);
    expect((await service.createRun(corrected)).id).toBe(run.id);
    expect(await serverDB.select().from(agentEvalRuns)).toHaveLength(1);
  });

  it('rejects an exclude-all selection without leaving a run or topics', async () => {
    const { dataset } = await createDataset();
    const service = new AgentEvalRunService(serverDB, userId);

    await expect(
      service.createRun({
        config: { caseSelection: { caseIds: ['question-1'], mode: 'exclude' } },
        datasetId: dataset.id,
        id: 'run_empty01',
      }),
    ).rejects.toThrow('Select at least one test case');
    expect(await serverDB.select().from(agentEvalRuns)).toHaveLength(0);
    expect(await serverDB.select().from(topics)).toHaveLength(0);
  });

  it('leaves selection to the external worker and keeps its no-topics creation contract', async () => {
    const { dataset } = await createDataset();
    const run = await new AgentEvalRunService(serverDB, userId).createRun({
      config: { caseSelection: { caseIds: ['question-1'], mode: 'exclude' } },
      datasetId: dataset.id,
      mode: 'external',
    });
    expect(run.status).toBe('pending');
    expect(await new AgentEvalRunTopicModel(serverDB, userId).findByRunId(run.id)).toHaveLength(0);
  });
});
