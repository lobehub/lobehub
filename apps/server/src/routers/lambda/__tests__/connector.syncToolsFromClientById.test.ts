// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { ConnectorStatus } from '@/database/schemas';

import { connectorRouter } from '../connector';

// `vi.mock` is hoisted by vitest's transformer above all imports at runtime,
// so the relative import order doesn't matter functionally — the mocks below
// are still active when the router module is evaluated. They live below the
// imports to satisfy `import-x/first` without disabling the rule.
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  // The real `wsCompatProcedure` validates a Better-Auth session; for unit
  // tests we skip auth and rely on the test ctx already carrying `userId`.
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

const CONNECTOR_ID = '9f1f6f30-0000-4000-8000-000000000001';

// The desktop-reported install path for MCP servers the cloud can't reach
// (stdio / localhost / LAN endpoints, #16533): the client lists the tools
// locally and reports them into an existing connector row.
describe('connectorRouter.syncToolsFromClientById', () => {
  let connectorModelMock: any;
  let connectorToolModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    connectorModelMock = {
      findById: vi.fn().mockResolvedValue({
        id: CONNECTOR_ID,
        identifier: 'my-local-mcp',
        userId: 'user_test',
      }),
      updateStatus: vi.fn(),
    };
    connectorToolModelMock = { upsertMany: vi.fn() };

    vi.mocked(ConnectorModel).mockImplementation(() => connectorModelMock);
    vi.mocked(ConnectorToolModel).mockImplementation(() => connectorToolModelMock);
  });

  const caller = () =>
    connectorRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
    } as any);

  it('upserts the reported tools and promotes the connector to connected', async () => {
    const res = await caller().syncToolsFromClientById({
      id: CONNECTOR_ID,
      tools: [
        { description: 'list things', inputSchema: { type: 'object' }, toolName: 'list_things' },
        { toolName: 'delete_thing' },
      ],
    });

    expect(res).toEqual({ toolCount: 2 });
    expect(connectorToolModelMock.upsertMany).toHaveBeenCalledWith(CONNECTOR_ID, [
      expect.objectContaining({ crudType: 'read', toolName: 'list_things' }),
      expect.objectContaining({ crudType: 'delete', toolName: 'delete_thing' }),
    ]);
    expect(connectorModelMock.updateStatus).toHaveBeenCalledWith(
      CONNECTOR_ID,
      ConnectorStatus.connected,
    );
  });

  it('rejects an unknown connector id', async () => {
    connectorModelMock.findById.mockResolvedValue(undefined);

    await expect(
      caller().syncToolsFromClientById({ id: CONNECTOR_ID, tools: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(connectorToolModelMock.upsertMany).not.toHaveBeenCalled();
  });

  it("rejects reporting into another member's workspace connector", async () => {
    connectorModelMock.findById.mockResolvedValue({
      id: CONNECTOR_ID,
      identifier: 'my-local-mcp',
      userId: 'someone_else',
    });

    await expect(
      connectorRouter
        .createCaller({
          serverDB: {},
          userId: 'user_test',
          workspaceId: 'ws_1',
          workspaceRole: 'member',
        } as any)
        .syncToolsFromClientById({ id: CONNECTOR_ID, tools: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(connectorToolModelMock.upsertMany).not.toHaveBeenCalled();
    expect(connectorModelMock.updateStatus).not.toHaveBeenCalled();
  });
});
