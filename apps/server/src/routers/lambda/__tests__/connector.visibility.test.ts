// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
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

const CONNECTOR_ID = '9f1f6f30-0000-4000-8000-000000000003';
const member = () => callerFor({ workspaceId: 'ws-1', workspaceRole: 'member' });

describe('connectorRouter visibility', () => {
  let connectorModelMock: any;
  let agentModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectorMemberManage.mockResolvedValue('all_members');
    connectorModelMock = {
      copyToAgent: vi.fn().mockResolvedValue({ id: 'copied' }),
      create: vi.fn().mockResolvedValue({ id: 'created' }),
      findById: vi.fn(),
      findScopedByIdentifier: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };
    agentModelMock = {
      existsOwnedById: vi.fn().mockResolvedValue(true),
      getAgentVisibility: vi.fn().mockResolvedValue('private'),
    };
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return connectorModelMock;
    });
    vi.mocked(AgentModel).mockImplementation(function () {
      return agentModelMock;
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

  describe('create', () => {
    it('adds a private connector even when admins restricted the shared ones', async () => {
      mocks.getConnectorMemberManage.mockResolvedValue('admins_only');

      await expect(member().create({ ...createInput, visibility: 'private' })).resolves.toEqual({
        id: 'created',
        isNew: true,
      });
      expect(connectorModelMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private' }),
      );
    });

    it("looks for an existing row among the caller's private rows only", async () => {
      await member().create({ ...createInput, visibility: 'private' });

      expect(connectorModelMock.findScopedByIdentifier).toHaveBeenCalledWith(
        'my-mcp',
        undefined,
        undefined,
        'private',
      );
    });

    it('never stores a Composio account a member names on a connector they add', async () => {
      // Regression: a member read a shared connection's account id and added a
      // private connector naming it. Every Composio write then found a
      // teammate's private row holding the account and refused its real owner,
      // while nobody else could see the planted row to remove it.
      await member().create({
        ...createInput,
        metadata: { avatar: '🔌', composio: { connectedAccountId: 'acc-shared' } },
        visibility: 'private',
      });

      expect(connectorModelMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { avatar: '🔌' } }),
      );
    });

    it('shares by default, and stores personal rows as shared', async () => {
      await member().create(createInput);
      await callerFor({}).create({ ...createInput, visibility: 'private' });

      expect(connectorModelMock.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ visibility: 'public' }),
      );
      expect(connectorModelMock.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ visibility: 'public' }),
      );
    });
  });

  describe.each(['bindAgent', 'copyToAgent', 'mountToAgent'] as const)('%s', (procedure) => {
    const privateConnector = {
      agentId: null,
      id: CONNECTOR_ID,
      identifier: 'my-mcp',
      metadata: null,
      userId: 'me',
      visibility: 'private',
    };

    it('refuses to hand a private connector to a workspace agent', async () => {
      connectorModelMock.findById.mockResolvedValue(privateConnector);
      agentModelMock.getAgentVisibility.mockResolvedValue('public');

      await expect(
        member()[procedure]({ agentId: 'agt-shared', connectorId: CONNECTOR_ID }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(connectorModelMock.update).not.toHaveBeenCalled();
      expect(connectorModelMock.copyToAgent).not.toHaveBeenCalled();
    });

    it("allows it on the creator's own private agent", async () => {
      connectorModelMock.findById.mockResolvedValue(privateConnector);

      await expect(
        member()[procedure]({ agentId: 'agt-mine', connectorId: CONNECTOR_ID }),
      ).resolves.toBeDefined();
    });

    it('leaves shared connectors to the existing rules', async () => {
      connectorModelMock.findById.mockResolvedValue({ ...privateConnector, visibility: 'public' });
      agentModelMock.getAgentVisibility.mockResolvedValue('public');

      await expect(
        member()[procedure]({ agentId: 'agt-shared', connectorId: CONNECTOR_ID }),
      ).resolves.toBeDefined();
      expect(agentModelMock.getAgentVisibility).not.toHaveBeenCalled();
    });
  });

  describe('update visibility', () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
      agentId: null,
      id: CONNECTOR_ID,
      identifier: 'my-mcp',
      metadata: null,
      userId: 'me',
      visibility: 'public',
      ...overrides,
    });

    it('lets the creator make their shared connector private', async () => {
      connectorModelMock.findById.mockResolvedValue(row());

      await member().update({ id: CONNECTOR_ID, patch: { visibility: 'private' } });

      expect(connectorModelMock.update).toHaveBeenCalledWith(
        CONNECTOR_ID,
        expect.objectContaining({ visibility: 'private' }),
      );
    });

    it('lets the member who linked a Composio account make it private', async () => {
      connectorModelMock.findById.mockResolvedValue(
        row({ metadata: { composio: { connectedAccountId: 'acc-1', linkedByUserId: 'me' } } }),
      );

      await member().update({ id: CONNECTOR_ID, patch: { visibility: 'private' } });

      expect(connectorModelMock.update).toHaveBeenCalledWith(
        CONNECTOR_ID,
        expect.objectContaining({ visibility: 'private' }),
      );
    });

    it('refuses to make private a Composio account someone else linked', async () => {
      // The creator opened a teammate's legacy connection first, so the row is
      // theirs, but the account runs as the teammate. Making it private would
      // take the teammate's connection from the teammate and everyone else.
      connectorModelMock.findById.mockResolvedValue(
        row({ metadata: { composio: { connectedAccountId: 'acc-1', linkedByUserId: 'mate' } } }),
      );

      await expect(
        member().update({ id: CONNECTOR_ID, patch: { visibility: 'private' } }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(connectorModelMock.update).not.toHaveBeenCalled();
    });

    it('keeps the Composio account a row names when an edit sends another', async () => {
      connectorModelMock.findById.mockResolvedValue(
        row({
          metadata: { composio: { connectedAccountId: 'acc-1', linkedByUserId: 'me' } },
          visibility: 'private',
        }),
      );

      await member().update({
        id: CONNECTOR_ID,
        patch: { metadata: { avatar: '🔌', composio: { connectedAccountId: 'acc-shared' } } },
      });

      expect(connectorModelMock.update).toHaveBeenCalledWith(
        CONNECTOR_ID,
        expect.objectContaining({
          metadata: {
            avatar: '🔌',
            composio: { connectedAccountId: 'acc-1', linkedByUserId: 'me' },
          },
        }),
      );
    });

    it('never lets someone else change who a connector is shared with', async () => {
      connectorModelMock.findById.mockResolvedValue(row({ userId: 'someone-else' }));

      await expect(
        callerFor({ workspaceId: 'ws-1', workspaceRole: 'owner' }).update({
          id: CONNECTOR_ID,
          patch: { visibility: 'private' },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(connectorModelMock.update).not.toHaveBeenCalled();
    });

    it('follows the member policy when sharing a private connector', async () => {
      mocks.getConnectorMemberManage.mockResolvedValue('admins_only');
      connectorModelMock.findById.mockResolvedValue(row({ visibility: 'private' }));

      await expect(
        member().update({ id: CONNECTOR_ID, patch: { visibility: 'public' } }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('refuses a second shared connector of the same identifier', async () => {
      connectorModelMock.findById.mockResolvedValue(row({ visibility: 'private' }));
      connectorModelMock.findScopedByIdentifier.mockResolvedValue(row({ id: 'other' }));

      await expect(
        member().update({ id: CONNECTOR_ID, patch: { visibility: 'public' } }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it("leaves an agent's own connector to its agent", async () => {
      connectorModelMock.findById.mockResolvedValue(row({ agentId: 'agt-1' }));

      await expect(
        member().update({ id: CONNECTOR_ID, patch: { visibility: 'private' } }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });
});
