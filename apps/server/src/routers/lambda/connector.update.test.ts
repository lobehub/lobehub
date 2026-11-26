// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectorRouter } from './connector';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
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
});

describe('connector.update endpoint fields', () => {
  it('clears the transport, URL and stdio config when the patch sends null', async () => {
    await caller.update({
      id,
      patch: { mcpConnectionType: null, mcpServerUrl: null, mcpStdioConfig: null },
    });

    expect(mocks.update).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        mcpConnectionType: null,
        mcpServerUrl: null,
        mcpStdioConfig: null,
      }),
    );
  });

  it('leaves the endpoint untouched when the patch omits it', async () => {
    await caller.update({ id, patch: { name: 'Renamed' } });

    const patch = mocks.update.mock.calls[0][1];
    expect(patch).toMatchObject({ name: 'Renamed' });
    for (const field of ['mcpConnectionType', 'mcpServerUrl', 'mcpStdioConfig'])
      expect(patch).not.toHaveProperty(field);
  });
});
