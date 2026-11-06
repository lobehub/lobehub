import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalBenchmarkModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { agentEvalDatasets, agentEvalTestCases, agents, topics } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { CASE_AGENT_MODEL_REQUIRED } from '@/server/services/agentEvalRun/caseAgent';

import { cleanupDB, serverDB, userId } from './_setup';

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return { interruptOperation: vi.fn().mockResolvedValue(true) };
  }),
}));

vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: { triggerRunThreadTrajectory: vi.fn() },
}));

const mockExecAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: mockExecAgent };
  }),
}));

beforeEach(async () => {
  await cleanupDB();
  mockExecAgent.mockReset();
});

const createDataset = async (
  cases: Array<{
    agent?: { name?: string; plugins?: string[]; systemRole?: string; title?: string };
    input: string;
  }>,
) => {
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

  const testCases = [];
  for (const [index, item] of cases.entries()) {
    const [testCase] = await serverDB
      .insert(agentEvalTestCases)
      .values({
        content: {
          input: item.input,
          ...(item.agent && { environment: { agent: item.agent } }),
        },
        datasetId: dataset.id,
        metadata: { caseId: `case-${index + 1}` },
        sortOrder: index,
        userId,
      })
      .returning();
    testCases.push(testCase);
  }

  return { dataset, testCases };
};

const topicAgentOf = async (runId: string, testCaseId: string) => {
  const runTopic = await new AgentEvalRunTopicModel(serverDB, userId).findByRunAndTestCase(
    runId,
    testCaseId,
  );
  const [topic] = await serverDB.select().from(topics).where(eq(topics.id, runTopic!.topicId));
  return topic.agentId;
};

const hiddenAgents = () =>
  serverDB
    .select()
    .from(agents)
    .where(and(eq(agents.userId, userId), eq(agents.virtual, true)));

describe('AgentEvalRunService case Agents', () => {
  it('runs each case of a model-only run on its own hidden Agent built from the case setup', async () => {
    const { dataset, testCases } = await createDataset([
      { agent: { plugins: ['shopify'], systemRole: 'You run a store.' }, input: 'Check orders' },
      { agent: { plugins: [], systemRole: 'You are a coach.' }, input: 'Plan my week' },
    ]);

    const service = new AgentEvalRunService(serverDB, userId);
    const run = await service.createRun({
      config: { model: 'gpt-4.1-mini', provider: 'openai' },
      datasetId: dataset.id,
    });

    const created = await hiddenAgents();
    expect(created).toHaveLength(2);

    for (const testCase of testCases) {
      const agentId = await topicAgentOf(run.id, testCase.id);
      const agent = created.find((item) => item.id === agentId)!;
      const setup = (testCase.content as any).environment.agent;

      expect(agent.virtual).toBe(true);
      expect(agent.systemRole).toBe(setup.systemRole);
      expect(agent.plugins).toEqual(setup.plugins);
      expect(agent.model).toBe('gpt-4.1-mini');
      expect(agent.provider).toBe('openai');
      expect(agent.slug).toBe(`eval-${run.id}-${testCase.id}`);
      // No identity line reaches the prompt unless the case declares one.
      expect(agent.name).toBeNull();
      expect(agent.title).toBeNull();
    }
  });

  it('applies the contender settings of a model-only run to every hidden Agent', async () => {
    const { dataset, testCases } = await createDataset([
      { agent: { plugins: [], systemRole: 'You run a store.' }, input: 'Check orders' },
    ]);

    const service = new AgentEvalRunService(serverDB, userId);
    const run = await service.createRun({
      config: {
        chatConfig: { reasoningEffort: 'high', thinkingBudget: 4096 },
        model: 'gpt-4.1-mini',
        params: { temperature: 0.2, top_p: 0.9 },
        provider: 'openai',
      },
      datasetId: dataset.id,
    });

    const agentId = await topicAgentOf(run.id, testCases[0].id);
    const agent = (await hiddenAgents()).find((item) => item.id === agentId)!;

    // The same model with other settings is another contender, so the settings
    // must reach the Agent that actually answers.
    expect(agent.params).toMatchObject({ temperature: 0.2, top_p: 0.9 });
    expect(agent.chatConfig).toMatchObject({ reasoningEffort: 'high', thinkingBudget: 4096 });
  });

  it('gives the hidden Agent only the identity the case declares', async () => {
    const { dataset, testCases } = await createDataset([
      {
        agent: { name: 'Juniper', systemRole: 'You run a tea shop.', title: 'Shop assistant' },
        input: 'Hi',
      },
    ]);

    const service = new AgentEvalRunService(serverDB, userId);
    const run = await service.createRun({
      config: { model: 'gpt-4.1-mini', provider: 'openai' },
      datasetId: dataset.id,
    });

    const agentId = await topicAgentOf(run.id, testCases[0].id);
    const [agent] = await serverDB.select().from(agents).where(eq(agents.id, agentId!));
    expect(agent.name).toBe('Juniper');
    expect(agent.title).toBe('Shop assistant');
  });

  it('keeps cases without a setup on the target Agent when the run picks no model', async () => {
    const { dataset, testCases } = await createDataset([{ input: 'Plain question' }]);

    const service = new AgentEvalRunService(serverDB, userId);
    const run = await service.createRun({ datasetId: dataset.id });

    expect(await hiddenAgents()).toHaveLength(0);
    expect(await topicAgentOf(run.id, testCases[0].id)).toBeNull();
  });

  it('rejects a case setup when neither a target Agent nor a model is chosen', async () => {
    const { dataset } = await createDataset([
      { agent: { systemRole: 'You run a store.' }, input: 'Check orders' },
    ]);

    const service = new AgentEvalRunService(serverDB, userId);
    await expect(service.createRun({ datasetId: dataset.id })).rejects.toThrow(
      CASE_AGENT_MODEL_REQUIRED,
    );
    expect(await hiddenAgents()).toHaveLength(0);
  });

  it('reuses the hidden Agent when a case is retried', async () => {
    const { dataset, testCases } = await createDataset([
      { agent: { systemRole: 'You run a store.' }, input: 'Check orders' },
    ]);

    const service = new AgentEvalRunService(serverDB, userId);
    const run = await service.createRun({
      config: { model: 'gpt-4.1-mini', provider: 'openai' },
      datasetId: dataset.id,
    });
    const before = await topicAgentOf(run.id, testCases[0].id);

    const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
    const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCases[0].id);
    await runTopicModel.updateByRunAndTopic(run.id, runTopic!.topicId, { status: 'error' });
    await service.retrySingleCase(run.id, testCases[0].id);

    expect(await topicAgentOf(run.id, testCases[0].id)).toBe(before);
    expect(await hiddenAgents()).toHaveLength(1);
  });

  it('executes each case on the Agent its topic belongs to', async () => {
    const { dataset, testCases } = await createDataset([
      { agent: { systemRole: 'You run a store.' }, input: 'Check orders' },
    ]);

    const service = new AgentEvalRunService(serverDB, userId);
    const run = await service.createRun({
      config: { model: 'gpt-4.1-mini', provider: 'openai' },
      datasetId: dataset.id,
    });
    mockExecAgent.mockResolvedValue({ operationId: 'op-1' });

    await service.executeTrajectory({
      run: { config: run.config, datasetId: dataset.id, targetAgentId: null },
      runId: run.id,
      testCase: { content: { input: 'Check orders' }, sortOrder: 0 },
      testCaseId: testCases[0].id,
    });

    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: await topicAgentOf(run.id, testCases[0].id) }),
    );
  });

  it('hands the contender settings to execAgent as its override', async () => {
    const { dataset, testCases } = await createDataset([
      { agent: { systemRole: 'You run a store.' }, input: 'Check orders' },
    ]);

    const service = new AgentEvalRunService(serverDB, userId);
    const chatConfig = { enableReasoning: true, gpt5_6ReasoningEffort: 'high' as const };
    const run = await service.createRun({
      config: { chatConfig, model: 'gpt-6.1-terra', provider: 'openrouter' },
      datasetId: dataset.id,
    });
    mockExecAgent.mockResolvedValue({ operationId: 'op-1' });

    await service.executeTrajectory({
      run: { config: run.config, datasetId: dataset.id, targetAgentId: null },
      runId: run.id,
      testCase: { content: { input: 'Check orders' }, sortOrder: 0 },
      testCaseId: testCases[0].id,
    });

    // The runtime takes reasoning effort from the account's saved per-model
    // defaults unless an override names it: the run must use what it records.
    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({ chatConfigOverride: chatConfig }),
    );
  });

  it('deletes the hidden Agents with the run', async () => {
    const { dataset } = await createDataset([
      { agent: { systemRole: 'You run a store.' }, input: 'Check orders' },
      { agent: { systemRole: 'You are a coach.' }, input: 'Plan my week' },
    ]);

    const service = new AgentEvalRunService(serverDB, userId);
    const run = await service.createRun({
      config: { model: 'gpt-4.1-mini', provider: 'openai' },
      datasetId: dataset.id,
    });
    expect(await hiddenAgents()).toHaveLength(2);

    await service.deleteRun(run.id);

    expect(await hiddenAgents()).toHaveLength(0);
  });
});
