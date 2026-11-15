// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { syncConnectorToolsById } from '@/server/services/connector/sync';

import { evalConnectorRouter } from './connectors';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findStored: vi.fn(),
  listStored: vi.fn(),
  findPublicById: vi.fn(),
  modelsForDataset: vi.fn(),
  queryPublic: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/server/services/connector/sync', () => ({ syncConnectorToolsById: vi.fn() }));
vi.mock('./procedures', async () => {
  const { publicProcedure } = await import('@/libs/trpc/lambda');
  const procedure = publicProcedure.use((opts) =>
    opts.next({
      ctx: {
        environmentConnections: { find: mocks.findStored, listForDataset: mocks.listStored },
        evalConnectorModelsForDataset: mocks.modelsForDataset,
      },
    }),
  );
  return { agentEvalProcedure: procedure, agentEvalProcedureWrite: procedure };
});

const id = '5d9f523a-7180-4d3e-9242-906abc41a612';
const input = { datasetId: 'dataset-a', id };
const models = {
  connectorModel: {
    create: mocks.create,
    findPublicById: mocks.findPublicById,
    queryPublic: mocks.queryPublic,
    update: mocks.update,
  },
  connectorToolModel: {},
};
const caller = createCallerFactory(evalConnectorRouter)({} as never);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.modelsForDataset.mockResolvedValue(models);
  mocks.findPublicById.mockResolvedValue({
    hasCredentials: true,
    isEnabled: true,
    mcpConnectionType: 'http',
    id,
    mcpServerUrl: 'https://mock.example/mcp',
    name: 'Management name',
    status: 'connected',
    credentials: 'private-token',
    metadata: { customHeaders: { Authorization: 'private-header' } },
  });
  mocks.create.mockResolvedValue({ id, credentials: 'encrypted-secret' });
  mocks.listStored.mockResolvedValue([]);
});

describe('Dataset connector management', () => {
  it('requires the Dataset in every list query and retains disabled rows within that exact scope', async () => {
    await expect(caller.listEvalConnectors({} as never)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    mocks.queryPublic.mockResolvedValue([{ id, isEnabled: false, credentials: 'private-token' }]);
    const rows = await caller.listEvalConnectors({ datasetId: 'dataset-b' });
    expect(rows).toEqual([expect.objectContaining({ id, isEnabled: false })]);
    expect(JSON.stringify(rows)).not.toContain('private-token');
    expect(mocks.modelsForDataset).toHaveBeenCalledWith('dataset-b');
  });

  it('returns only management fields and never credentials or metadata', async () => {
    expect(await caller.getEvalConnector(input)).toEqual({
      hasCredentials: true,
      isEnabled: true,
      mcpConnectionType: 'http',
      id,
      mcpServerUrl: 'https://mock.example/mcp',
      name: 'Management name',
      status: 'connected',
    });
    expect(mocks.modelsForDataset).toHaveBeenCalledWith('dataset-a');
  });

  it('rejects an inaccessible connection before update or connectivity tests', async () => {
    mocks.findPublicById.mockResolvedValue(null);
    await expect(
      caller.updateEvalConnector({
        ...input,
        name: 'New',
        mcpServerUrl: 'https://mock.example/mcp',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller.testEvalConnector(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(syncConnectorToolsById).not.toHaveBeenCalled();
  });

  it('keeps omitted auth unchanged and explicitly encodes replacements or clearing', async () => {
    const patch = { ...input, name: 'New', mcpServerUrl: 'https://mock.example/mcp' };
    await caller.updateEvalConnector(patch);
    expect(mocks.update).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ credentials: undefined }),
    );
    await caller.updateEvalConnector({ ...patch, credentials: null });
    expect(mocks.update).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ credentials: null }),
    );
    await caller.updateEvalConnector({
      ...patch,
      credentials: { type: 'bearer', token: 'new-token' },
    });
    expect(mocks.update).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({
        credentials: JSON.stringify({ token: 'new-token', type: 'bearer' }),
      }),
    );
  });

  it('creates a distinct evaluation record with server-owned Dataset marker', async () => {
    expect(
      await caller.createEvalConnector({
        datasetId: input.datasetId,
        name: 'Shared name',
        mcpServerUrl: 'https://mock.example/mcp',
        credentials: { type: 'header', headers: { Authorization: 'synthetic' } },
      }),
    ).toEqual({ id });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: expect.stringMatching(/^eval-mock-/),
        metadata: { agentEval: { datasetId: input.datasetId } },
        name: 'Shared name',
        credentials: JSON.stringify({ headers: { Authorization: 'synthetic' }, type: 'header' }),
      }),
    );
  });

  it('rejects credentials embedded in addresses before persistence', async () => {
    await expect(
      caller.createEvalConnector({
        datasetId: input.datasetId,
        name: 'Mock',
        mcpServerUrl: 'https://user:secret@mock.example/mcp',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('tests through scoped models and redacts upstream failures', async () => {
    vi.mocked(syncConnectorToolsById).mockRejectedValue(
      new Error('Authorization: Bearer private-token'),
    );
    await expect(caller.testEvalConnector(input)).rejects.toMatchObject({
      message: 'Connection test failed. Check the address and authentication, then retry.',
    });
    expect(syncConnectorToolsById).toHaveBeenCalledWith(id, models, {
      pruneMissingAutoTools: true,
    });
  });
});

describe('connections stored in an Environment', () => {
  const stored = {
    connection: {
      credentials: 'encrypted-stored-secret',
      name: 'Gmail mock',
      url: 'https://mock.example/mcp/ds/gmail',
    },
    connectorId: 'env:shared-world:gmail',
    environmentId: 'shared-world',
    mutable: true,
    service: 'gmail',
  };

  it('lists and reads them by their env id without credentials', async () => {
    mocks.queryPublic.mockResolvedValue([]);
    mocks.listStored.mockResolvedValue([stored]);
    mocks.findStored.mockResolvedValue(stored);
    const listed = await caller.listEvalConnectors({ datasetId: 'dataset-a' });
    const read = await caller.getEvalConnector({
      datasetId: 'dataset-a',
      id: 'env:shared-world:gmail',
    });
    expect(listed).toEqual([read]);
    expect(read).toEqual({
      hasCredentials: true,
      id: 'env:shared-world:gmail',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mock.example/mcp/ds/gmail',
      name: 'Gmail mock',
      status: 'connected',
    });
    expect(JSON.stringify(listed)).not.toContain('encrypted-stored-secret');
    expect(mocks.findStored).toHaveBeenCalledWith('dataset-a', 'env:shared-world:gmail');
  });
});
