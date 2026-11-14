import type { EvalCaseEnvironment } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalEnvironmentModel, AgentEvalRunModel } from '@/database/models/agentEval';
import { ConnectorModel } from '@/database/models/connector';
import { agentEvalDatasets, agentEvalRuns, agentEvalTestCases } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { serializeStepResult } from '@/server/workflows/testing/stepContext';

import { getEvalContextParams } from '../utils';
import { cleanupDB, serverDB, userId } from './_setup';

const { listRawTools, gateKeeper } = vi.hoisted(() => ({
  listRawTools: vi.fn(),
  gateKeeper: {
    decrypt: async (ciphertext: string) => ({ plaintext: ciphertext.replace(/^sealed:/, '') }),
    encrypt: async (plaintext: string) => `sealed:${plaintext}`,
  },
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: { listRawTools } }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => gateKeeper },
}));
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: class {
    interruptOperation = vi.fn();
  },
}));
vi.mock('@/server/workflows/agentEvalRun', () => ({ AgentEvalRunWorkflow: {} }));

beforeEach(async () => {
  await cleanupDB();
  listRawTools.mockReset().mockResolvedValue([{ name: 'read', inputSchema: { type: 'object' } }]);
});

const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const fixture = async () => {
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      evalConfig: { envPrompt: 'Dataset instructions' },
      identifier: 'payload',
      name: 'Payload',
      userId,
    })
    .returning();
  const connector = await ConnectorModel.forEvaluation(
    serverDB,
    userId,
    dataset.id,
    undefined,
    gateKeeper,
  ).create({
    credentials: JSON.stringify({ type: 'bearer', token: 'synthetic-secret-never-in-checkpoint' }),
    identifier: 'eval-private',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://private.example/mcp',
    name: 'Management name',
    sourceType: 'custom',
    status: 'disconnected',
  });
  const config: EvalCaseEnvironment = {
    agent: { plugins: ['notion'], systemRole: 'Persona' },
    connectorBindings: { notion: { connectorId: connector.id, transport: 'mcp' } },
    envPrompt: 'Case instructions',
    mock: { services: ['notion'] },
    sessionDate: '2026-11-04',
    timezone: 'UTC',
    toolManifests: {
      notion: {
        api: [
          {
            name: 'read',
            description: 'Original contract detail. '.repeat(2600),
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        ],
        identifier: 'notion',
        meta: { description: 'Original API', title: 'Notion' },
        type: 'mcp',
      },
    },
  };
  const environment = await new AgentEvalEnvironmentModel(serverDB, userId).create({
    config,
    name: 'Shared',
  });
  const [testCase] = await serverDB
    .insert(agentEvalTestCases)
    .values({
      content: {
        input: 'Read data',
        expected: 'Expected answer',
        messages: [{ role: 'user', content: 'History' }],
      },
      datasetId: dataset.id,
      environmentId: environment.id,
      metadata: { caseId: 'native-case' },
      sortOrder: 1,
      userId,
    })
    .returning();
  const service = new AgentEvalRunService(serverDB, userId);
  const run = await service.createRun({
    config: {
      k: 3,
      maxSteps: 24,
      model: 'fixture',
      provider: 'fixture',
      chatConfig: { reasoning_effort: 'high' },
    },
    datasetId: dataset.id,
  });
  return { config, dataset, run, service, testCase };
};

describe('Trajectory checkpoint payload', () => {
  it('keeps one case payload unchanged when 49 unrelated frozen contracts are added', async () => {
    const { run, service, testCase } = await fixture();
    const before = await service.loadTrajectoryData(run.id, testCase.id);
    if ('error' in before) throw new Error(before.error);
    const current = run.config!.connectorSnapshots![testCase.id];
    const connectorSnapshots = {
      [testCase.id]: current,
      ...Object.fromEntries(
        Array.from({ length: 49 }, (_, index) => [`unrelated-${index}`, current]),
      ),
    };
    await serverDB
      .update(agentEvalRuns)
      .set({ config: { ...run.config, connectorSnapshots } })
      .where(eq(agentEvalRuns.id, run.id));
    const after = await service.loadTrajectoryData(run.id, testCase.id);
    if ('error' in after) throw new Error(after.error);
    expect(byteLength(after)).toBe(byteLength(before));
    expect(Object.keys(after.run.config!.connectorSnapshots!)).toEqual([testCase.id]);
    expect(after.testCase.content).not.toHaveProperty('environment');
    expect(after.testCase.content).toEqual(before.testCase.content);
    expect(JSON.stringify(after)).not.toMatch(/unrelated-|synthetic-secret|private\.example/);
    const stored = await new AgentEvalRunModel(serverDB, userId).findById(run.id);
    expect(Object.keys(stored!.config!.connectorSnapshots!)).toHaveLength(50);
    const oldPayload = {
      ...after,
      run: stored,
      testCase: {
        ...after.testCase,
        content: { ...after.testCase.content, environment: after.environment },
      },
    };
    expect(byteLength(oldPayload)).toBeGreaterThan(byteLength(after) * 20);
  });

  it('preserves frozen aliases, fingerprints, Dataset scope, execution settings and context across JSON checkpoints', async () => {
    const { config, dataset, run, service, testCase } = await fixture();
    const loaded = await service.loadTrajectoryData(run.id, testCase.id);
    if ('error' in loaded) throw new Error(loaded.error);
    const restored = serializeStepResult(loaded);
    expect(restored.environment).toEqual(config);
    expect(restored.run.config).toEqual(run.config);
    const snapshot = restored.run.config!.connectorSnapshots![testCase.id].notion;
    expect(snapshot.datasetId).toBe(dataset.id);
    expect(snapshot.fingerprint).toMatch(/^[a-f\d]{64}$/);
    expect(snapshot.manifest).toEqual(config.toolManifests!.notion);
    expect(restored.testCase).toMatchObject({
      id: testCase.id,
      metadata: { caseId: 'native-case' },
      sortOrder: 1,
    });
    const context = (data: typeof loaded) =>
      getEvalContextParams(
        data.envPrompt,
        data.environment,
        'native-case',
        undefined,
        'attempt',
        data.run.config!.connectorSnapshots![testCase.id],
      );
    expect(context(restored)).toEqual(context(loaded));
  });

  it('rejects a different Dataset case even when both belong to the same owner', async () => {
    const { run, service } = await fixture();
    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({ identifier: 'other', name: 'Other', userId })
      .returning();
    const [testCase] = await serverDB
      .insert(agentEvalTestCases)
      .values({ content: { input: 'Other' }, datasetId: dataset.id, userId })
      .returning();
    expect(await service.loadTrajectoryData(run.id, testCase.id)).toEqual({
      error: 'Test case not found',
    });
  });
});
