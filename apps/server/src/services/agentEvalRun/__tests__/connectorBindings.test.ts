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
  const connectorModel = ConnectorModel.forEvaluation(
    serverDB,
    userId,
    dataset.id,
    undefined,
    gateKeeper,
  );
  const connector = await connectorModel.create({
    credentials: JSON.stringify({ type: 'bearer', token: 'private-token' }),
    identifier: 'private-mock',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://private.test/mcp',
    metadata: { agentEval: { datasetId: dataset.id } },
    name: 'Private mock',
    sourceType: 'custom',
    status: 'disconnected',
  });
  const environment = await new AgentEvalEnvironmentModel(serverDB, userId).create({
    identifier: 'fixture',
    name: 'Fixture',
    config: {
      mock: { services: ['notion'] },
      toolManifests: {
        notion: {
          identifier: 'notion',
          type: 'mcp',
          meta: { title: 'Notion' },
          api: [{ name: 'read', description: '', parameters: { type: 'object' } }],
        },
      },
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
    expect(run.config?.connectorSnapshots?.[cases[0].id].notion.datasetId).toBe(dataset.id);
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
    await connectorModel.update(connector.id, {
      credentials: null,
      mcpServerUrl: 'https://different.test/mcp',
    });
    await expect(service.assertConnectorBindings(run)).rejects.toThrow('changed');
    const [saved] = await serverDB.select().from(agentEvalRuns).where(eq(agentEvalRuns.id, run.id));
    expect(saved.config?.connectorSnapshots).toEqual(run.config?.connectorSnapshots);
    expect(saved.status).toBe(run.status);
  });

  it('checks overlapping case connections once per create or start and preserves every alias', async () => {
    const { cases, connector, connectorModel, dataset } = await fixture();
    const second = await connectorModel.create({
      credentials: JSON.stringify({ type: 'bearer', token: 'second-token' }),
      identifier: 'second-mock',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://second.test/mcp',
      metadata: { agentEval: { datasetId: dataset.id } },
      name: 'Second mock',
      sourceType: 'custom',
      status: 'disconnected',
    });
    for (const [index, aliases] of [
      ['notion', 'docs'],
      ['linear', 'gmail'],
    ].entries()) {
      await serverDB
        .update(agentEvalTestCases)
        .set({
          content: {
            input: 'Read the fixture',
            environment: {
              mock: { services: aliases },
              toolManifests: Object.fromEntries(
                aliases.map((identifier) => [
                  identifier,
                  {
                    identifier,
                    type: 'mcp',
                    meta: { title: identifier },
                    api: [
                      {
                        name: 'read',
                        description: 'Original read',
                        parameters: { type: 'object' },
                      },
                    ],
                  },
                ]),
              ),
              connectorBindings: {
                [aliases[0]]: { connectorId: connector.id },
                [aliases[1]]: { connectorId: second.id, transport: 'mcp' },
              },
            },
          },
        })
        .where(eq(agentEvalTestCases.id, cases[index].id));
    }

    const service = new AgentEvalRunService(serverDB, userId);
    const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
    expect(listRawTools).toHaveBeenCalledTimes(2);
    const snapshots = run.config!.connectorSnapshots!;
    expect(Object.keys(snapshots[cases[0].id]).sort()).toEqual(['docs', 'notion']);
    expect(Object.keys(snapshots[cases[1].id]).sort()).toEqual(['gmail', 'linear']);
    expect(snapshots[cases[0].id].notion.connectorId).toEqual(
      snapshots[cases[1].id].linear.connectorId,
    );
    expect(snapshots[cases[1].id].linear.manifest?.identifier).toBe('linear');
    expect(snapshots[cases[0].id].docs.connectorId).toEqual(
      snapshots[cases[1].id].gmail.connectorId,
    );

    await service.assertConnectorBindings(run);
    expect(listRawTools).toHaveBeenCalledTimes(4);
    await connectorModel.update(connector.id, {
      credentials: JSON.stringify({ type: 'bearer', token: 'rotated-token' }),
    });
    await service.assertConnectorBindings(run);
    expect(listRawTools).toHaveBeenCalledTimes(6);
    expect(
      listRawTools.mock.calls
        .slice(-2)
        .map(([params]) => params.auth.token)
        .sort(),
    ).toEqual(['rotated-token', 'second-token']);

    const secondCaseSnapshot = snapshots[cases[1].id].gmail;
    snapshots[cases[1].id].gmail = { ...secondCaseSnapshot, fingerprint: 'stale' };
    await expect(service.assertConnectorBindings(run)).rejects.toThrow('changed');
    expect(listRawTools).toHaveBeenCalledTimes(6);
    snapshots[cases[1].id].gmail = secondCaseSnapshot;

    listRawTools.mockResolvedValue([{ name: 'changed_tool', inputSchema: { type: 'object' } }]);
    await expect(service.assertConnectorBindings(run)).rejects.toThrow('changed');
    const [saved] = await serverDB.select().from(agentEvalRuns).where(eq(agentEvalRuns.id, run.id));
    expect(saved.config?.connectorSnapshots).toEqual(snapshots);
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
