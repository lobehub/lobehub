import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalEnvironmentModel } from '@/database/models/agentEval';
import { ConnectorModel } from '@/database/models/connector';
import { agentEvalDatasets, agentEvalRuns, agentEvalTestCases } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { getCaseConnectorBindings } from '../connectorBindings';
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

const fixture = async (bound = true) => {
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({ identifier: 'private-dataset', name: 'Private dataset', userId })
    .returning();
  const connectorModel = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
  const connector = await connectorModel.create({
    credentials: JSON.stringify({ type: 'bearer', token: 'private-token' }),
    identifier: 'private-mock',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://private.test/mcp',
    name: 'Private mock',
    sourceType: 'custom',
    status: 'disconnected',
  });
  const environment = await new AgentEvalEnvironmentModel(serverDB, userId).create({
    datasetId: dataset.id,
    identifier: 'fixture',
    name: 'Fixture',
    config: {
      mock: { services: ['notion'] },
      ...(bound && { connectorBindings: { notion: { connectorId: connector.id } } }),
    },
  });
  const cases = await serverDB
    .insert(agentEvalTestCases)
    .values(
      [0, 1].map((sortOrder) => ({
        content: { input: 'Read the fixture' },
        datasetId: dataset.id,
        environmentId: environment.id,
        sortOrder,
        userId,
      })),
    )
    .returning();
  return { cases, connector, connectorModel, dataset };
};

describe('run-bound mock connections', () => {
  it('uses only the case effective mock services when bindings are inherited from a broader environment', () => {
    expect(
      getCaseConnectorBindings({
        mock: { services: ['notion'] },
        connectorBindings: {
          notion: { connectorId: 'notion-id' },
          gmail: { connectorId: 'gmail-id' },
        },
      }),
    ).toEqual({ notion: { connectorId: 'notion-id' } });
    expect(
      getCaseConnectorBindings({
        mock: { services: [] },
        connectorBindings: { notion: { connectorId: 'notion-id' } },
      }),
    ).toEqual({});
  });
  it('captures shared Environment UUIDs without credentials and remains idempotent', async () => {
    const { cases, connector, dataset } = await fixture();
    const service = new AgentEvalRunService(serverDB, userId);
    const params = { datasetId: dataset.id, id: 'run_mock_binding', mode: 'external' as const };
    const run = await service.createRun(params);
    expect(Object.keys(run.config?.connectorSnapshots ?? {}).sort()).toEqual(
      cases.map((testCase) => testCase.id).sort(),
    );
    expect(run.config?.connectorSnapshots?.[cases[0].id].notion.connectorId).toBe(connector.id);
    expect(JSON.stringify(run.config)).not.toMatch(/private-token|private.test|credentials/);
    expect(listRawTools).toHaveBeenCalledOnce();
    expect((await service.createRun(params)).id).toBe(run.id);
    expect(listRawTools).toHaveBeenCalledOnce();
    const fork = await service.createRun({
      datasetId: dataset.id,
      parentRunId: run.id,
      mode: 'external',
    });
    expect(fork.config?.connectorSnapshots?.[cases[0].id]).toEqual(
      run.config?.connectorSnapshots?.[cases[0].id],
    );
  });

  it('blocks changed targets before start without altering the old run snapshots', async () => {
    const { connector, connectorModel, dataset } = await fixture();
    const service = new AgentEvalRunService(serverDB, userId);
    const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
    await service.assertConnectorBindings(run);
    await connectorModel.update(connector.id, { mcpServerUrl: 'https://different.test/mcp' });
    await expect(service.assertConnectorBindings(run)).rejects.toThrow('changed');
    const [saved] = await serverDB.select().from(agentEvalRuns).where(eq(agentEvalRuns.id, run.id));
    expect(saved.config?.connectorSnapshots).toEqual(run.config?.connectorSnapshots);
    expect(saved.status).toBe(run.status);
  });

  it('keeps an unbound imported dataset editable but creates no run until it is connected', async () => {
    const { dataset } = await fixture(false);
    const service = new AgentEvalRunService(serverDB, userId);
    await expect(service.createRun({ datasetId: dataset.id, mode: 'external' })).rejects.toThrow(
      'Bind these mock services',
    );
    expect(await serverDB.select().from(agentEvalRuns)).toEqual([]);
    expect(listRawTools).not.toHaveBeenCalled();
  });
});
