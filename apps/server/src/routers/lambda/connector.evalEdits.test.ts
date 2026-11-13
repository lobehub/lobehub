// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EvalConnectorUpdateError } from '@/database/models/connectorEval';

import { connectorRouter } from './connector';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findById: vi.fn(),
  findScopedByIdentifier: vi.fn(),
  refresh: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/server/services/inboundWebhook/lifecycle', () => ({
  refreshByConnector: mocks.refresh,
  removeByConnector: vi.fn(),
}));
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(function () {
    return mocks;
  }),
}));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => trpc.middleware((opts) => opts.next()),
    wsCompatProcedure: trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    serverDatabase: trpc.middleware((opts) =>
      opts.next({ ctx: { ...opts.ctx, serverDB: {} as never } }),
    ),
  };
});

const id = '9f1f6f30-0000-4000-8000-000000000001';
const caller = connectorRouter.createCaller({ userId: 'creator' } as never);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findById.mockResolvedValue({ id, userId: 'creator' });
  mocks.findScopedByIdentifier.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id });
  mocks.refresh.mockResolvedValue(undefined);
});

describe('imported evaluation connector edit boundary', () => {
  it('does not allow a normal create request to spoof evaluation import provenance', async () => {
    await caller.create({
      identifier: 'ordinary',
      name: 'Ordinary',
      sourceType: 'custom',
      metadata: { agentEval: { datasetId: 'spoofed' }, description: 'Keep this' },
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { description: 'Keep this' } }),
    );
  });

  it('reports an unsafe authentication-retaining address edit as a client error', async () => {
    mocks.update.mockRejectedValue(
      new EvalConnectorUpdateError(
        'Clear or replace authentication when changing a mock connection address',
      ),
    );
    await expect(
      caller.update({ id, patch: { mcpServerUrl: 'https://new-mock.example/mcp' } }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Clear or replace authentication when changing a mock connection address',
    });
  });

  it('refreshes event subscriptions only after replacement credentials are persisted', async () => {
    await caller.update({
      id,
      patch: { credentials: { type: 'bearer', token: 'replacement-token' } },
    });

    expect(JSON.parse(mocks.update.mock.calls[0][1].credentials)).toEqual({
      type: 'bearer',
      token: 'replacement-token',
    });
    expect(mocks.refresh).toHaveBeenCalledWith(
      {},
      { userId: 'creator', workspaceId: undefined },
      id,
    );
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0],
    );
  });

  it('refreshes subscriptions after changing header-based authentication without a credential patch', async () => {
    await caller.update({
      id,
      patch: { metadata: { customHeaders: { 'X-Api-Key': 'replacement-header' } } },
    });
    expect(mocks.refresh).toHaveBeenCalledWith(
      {},
      { userId: 'creator', workspaceId: undefined },
      id,
    );
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0],
    );
  });

  it('does not refresh subscriptions when the credential update fails', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Could not persist credentials'));
    await expect(
      caller.update({ id, patch: { credentials: { type: 'bearer', token: 'replacement-token' } } }),
    ).rejects.toThrow('Could not persist credentials');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('preserves the explicit-clear versus omitted credential distinction for model normalization', async () => {
    await caller.update({ id, patch: { metadata: { description: 'Keep authentication' } } });
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('credentials');
    expect(mocks.refresh).not.toHaveBeenCalled();
    await caller.update({
      id,
      patch: { credentials: null, metadata: { customHeaders: { 'X-Mock': 'header-token' } } },
    });
    expect(mocks.update.mock.calls[1][1]).toMatchObject({
      credentials: null,
      metadata: { customHeaders: { 'X-Mock': 'header-token' } },
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith(
      {},
      { userId: 'creator', workspaceId: undefined },
      id,
    );
    expect(mocks.update.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0],
    );
  });
});
