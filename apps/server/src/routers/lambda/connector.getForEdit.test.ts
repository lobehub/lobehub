// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';

import { connectorRouter } from './connector';

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
const workspaceMocks = vi.hoisted(() => ({
  getConnectorMemberManage: vi.fn(async () => 'all_members' as const),
}));
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: vi.fn(function () {
    return workspaceMocks;
  }),
}));
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

const connector = {
  id: '9f1f6f30-0000-4000-8000-000000000001',
  identifier: 'local-mcp',
  isEnabled: true,
  mcpConnectionType: 'stdio',
  mcpStdioConfig: { command: 'node', env: { TOKEN: 'fresh-secret' } },
  userId: 'creator',
};
const tools = [{ toolName: 'read_file', permission: 'disabled' }];
const queryByConnector = vi.fn();

describe('connectorRouter.getForEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return { findById: vi.fn().mockResolvedValue(connector) } as never;
    });
    vi.mocked(ConnectorToolModel).mockImplementation(function () {
      return { queryByConnector } as never;
    });
    queryByConnector.mockResolvedValue(tools);
  });

  const caller = (userId: string) =>
    connectorRouter.createCaller({
      userId,
      workspaceId: 'workspace',
      workspaceRole: 'member',
    } as never);

  it('returns current tool permissions with the protected stdio configuration', async () => {
    await expect(caller('creator').getForEdit({ id: connector.id })).resolves.toMatchObject({
      mcpStdioConfig: connector.mcpStdioConfig,
      tools,
    });
  });

  it('keeps credentials and tool reads behind the creator gate', async () => {
    await expect(caller('another-member').getForEdit({ id: connector.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(queryByConnector).not.toHaveBeenCalled();
  });
});
