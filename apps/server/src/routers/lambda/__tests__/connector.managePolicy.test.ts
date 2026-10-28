// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';

import { connectorRouter } from '../connector';

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  getConnectorMemberManage: vi.fn(
    async (): Promise<'admins_only' | 'all_members'> => 'all_members',
  ),
  updateConnectorMemberManage: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: vi.fn(function () {
    return {
      getConnectorMemberManage: mocks.getConnectorMemberManage,
      updateConnectorMemberManage: mocks.updateConnectorMemberManage,
    };
  }),
}));
vi.mock('@/database/models/workspaceAuditLog', () => ({
  WorkspaceAuditLogModel: vi.fn(function () {
    return { create: mocks.auditCreate };
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  const rank: Record<string, number> = { admin: 2, member: 1, owner: 3, viewer: 0 };
  return {
    requireWorkspaceRoleWhenScoped: (minRole: string) =>
      mod.trpc.middleware(async (opts: any) => {
        const { workspaceId, workspaceRole } = opts.ctx;
        if (workspaceId && (rank[workspaceRole] ?? -1) < rank[minRole]) {
          const { TRPCError } = await import('@trpc/server');
          throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${minRole}` });
        }
        return opts.next();
      }),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

const callerFor = (ctx: Record<string, unknown>) =>
  connectorRouter.createCaller({ serverDB: {}, userId: 'me', ...ctx } as any);

const CONNECTOR_ID = '9f1f6f30-0000-4000-8000-000000000002';

describe('connectorRouter manage policy', () => {
  let connectorModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectorMemberManage.mockResolvedValue('all_members');
    connectorModelMock = {
      create: vi.fn().mockResolvedValue({ id: 'created' }),
      findById: vi.fn(),
      findScopedByIdentifier: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return connectorModelMock;
    });
    vi.mocked(ConnectorToolModel).mockImplementation(function () {
      return { queryByConnector: vi.fn().mockResolvedValue([]) } as any;
    });
  });

  const createInput = {
    identifier: 'my-mcp',
    mcpConnectionType: 'stdio' as const,
    mcpStdioConfig: { command: 'echo' },
    name: 'My MCP',
    sourceType: 'custom' as const,
  };

  it("does not let a member re-add over another member's connector, even by default", async () => {
    // The upsert would rewrite the command while the row stays the creator's.
    connectorModelMock.findScopedByIdentifier.mockResolvedValue({
      id: CONNECTOR_ID,
      userId: 'someone-else',
    });

    await expect(
      callerFor({ workspaceId: 'ws-1', workspaceRole: 'member' }).create(createInput),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(connectorModelMock.update).not.toHaveBeenCalled();
  });

  it('lets a member add a new workspace connector by default, but not once restricted', async () => {
    const member = callerFor({ workspaceId: 'ws-1', workspaceRole: 'member' });

    await expect(member.create(createInput)).resolves.toEqual({ id: 'created', isNew: true });

    mocks.getConnectorMemberManage.mockResolvedValue('admins_only');
    await expect(member.create(createInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps the creator able to read their own connector config when members are restricted', async () => {
    // Desktop stdio connectors read their command through getForEdit at run time.
    mocks.getConnectorMemberManage.mockResolvedValue('admins_only');
    connectorModelMock.findById.mockResolvedValue({ id: CONNECTOR_ID, userId: 'me' });

    await expect(
      callerFor({ workspaceId: 'ws-1', workspaceRole: 'member' }).getForEdit({ id: CONNECTOR_ID }),
    ).resolves.toMatchObject({ id: CONNECTOR_ID });
  });

  it('reports what a member may do under each policy', async () => {
    const member = callerFor({ workspaceId: 'ws-1', workspaceRole: 'member' });

    await expect(member.getManagePolicy()).resolves.toEqual({
      canEditPolicy: false,
      canManage: true,
      memberManage: 'all_members',
    });

    mocks.getConnectorMemberManage.mockResolvedValue('admins_only');
    await expect(member.getManagePolicy()).resolves.toEqual({
      canEditPolicy: false,
      canManage: false,
      memberManage: 'admins_only',
    });
  });

  it('lets admins edit the policy and keep managing connectors', async () => {
    mocks.getConnectorMemberManage.mockResolvedValue('admins_only');

    await expect(
      callerFor({ workspaceId: 'ws-1', workspaceRole: 'admin' }).getManagePolicy(),
    ).resolves.toEqual({ canEditPolicy: true, canManage: true, memberManage: 'admins_only' });
  });

  it('updates the policy for an admin and records it in the audit log', async () => {
    await callerFor({ workspaceId: 'ws-1', workspaceRole: 'admin' }).updateManagePolicy({
      memberManage: 'admins_only',
    });

    expect(mocks.updateConnectorMemberManage).toHaveBeenCalledWith('ws-1', 'admins_only');
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      action: 'security.policy_updated',
      metadata: {
        policy: 'connector.member_manage',
        previous: 'all_members',
        value: 'admins_only',
      },
      userId: 'me',
      workspaceId: 'ws-1',
    });
  });

  it('rejects members and restricted API keys', async () => {
    await expect(
      callerFor({ workspaceId: 'ws-1', workspaceRole: 'member' }).updateManagePolicy({
        memberManage: 'admins_only',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      callerFor({
        apiKeyScopes: ['agent:read'],
        workspaceId: 'ws-1',
        workspaceRole: 'owner',
      }).updateManagePolicy({ memberManage: 'admins_only' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mocks.updateConnectorMemberManage).not.toHaveBeenCalled();
  });
});
