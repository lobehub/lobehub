// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import { syncConnectorToolsById } from '@/server/services/connector/sync';

import { connectorRouter } from '../connector';

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/server/services/connector/sync', () => ({ syncConnectorToolsById: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

describe('connectorRouter.syncTools', () => {
  const connectorId = '11111111-1111-4111-8111-111111111111';
  let connectorModelMock: any;
  let connectorToolModelMock: any;

  const caller = () =>
    connectorRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: null,
    } as any);

  beforeEach(() => {
    vi.resetAllMocks();
    connectorModelMock = {
      findById: vi.fn().mockResolvedValue({ id: connectorId, userId: 'user_test' }),
    };
    connectorToolModelMock = {};
    vi.mocked(AgentModel).mockImplementation(() => ({}) as any);
    vi.mocked(ConnectorModel).mockImplementation(() => connectorModelMock);
    vi.mocked(ConnectorToolModel).mockImplementation(() => connectorToolModelMock);
    vi.mocked(PluginModel).mockImplementation(() => ({}) as any);
    vi.mocked(syncConnectorToolsById).mockResolvedValue({ toolCount: 1 });
  });

  it('forwards normalized client tools with the scoped UUID context', async () => {
    const tools = [
      {
        description: 'Read a local file',
        inputSchema: { properties: { path: { type: 'string' } }, type: 'object' },
        toolName: 'read_file',
      },
    ];

    const result = await caller().syncTools({ id: connectorId, tools });

    expect(result).toEqual({ toolCount: 1 });
    expect(syncConnectorToolsById).toHaveBeenCalledWith(
      connectorId,
      expect.objectContaining({
        connectorModel: connectorModelMock,
        connectorToolModel: connectorToolModelMock,
      }),
      tools,
    );
  });

  it('keeps ID-only calls on the existing service path', async () => {
    await caller().syncTools({ id: connectorId });

    expect(syncConnectorToolsById).toHaveBeenCalledWith(
      connectorId,
      expect.objectContaining({
        connectorModel: connectorModelMock,
        connectorToolModel: connectorToolModelMock,
      }),
    );
  });

  it('reports client-tool persistence failures as sync failures', async () => {
    vi.mocked(syncConnectorToolsById).mockRejectedValue(new Error('database unavailable'));

    await expect(caller().syncTools({ id: connectorId, tools: [] })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to sync connector tools: database unavailable',
    });
  });

  it('preserves the existing ID-only fetch failure message', async () => {
    vi.mocked(syncConnectorToolsById).mockRejectedValue(new Error('MCP unavailable'));

    await expect(caller().syncTools({ id: connectorId })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch tools from MCP server: MCP unavailable',
    });
  });

  it('rejects client tool payloads beyond the bounded schema', async () => {
    await expect(
      caller().syncTools({
        id: connectorId,
        tools: Array.from({ length: 257 }, (_, index) => ({ toolName: `tool_${index}` })),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(syncConnectorToolsById).not.toHaveBeenCalled();
  });

  it('rejects duplicate client tool names', async () => {
    await expect(
      caller().syncTools({
        id: connectorId,
        tools: [{ toolName: 'duplicate' }, { toolName: 'duplicate' }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(syncConnectorToolsById).not.toHaveBeenCalled();
  });
});
