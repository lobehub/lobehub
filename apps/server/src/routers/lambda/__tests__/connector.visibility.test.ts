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
  /** The OAuth accounts a connector row holds, as `ConnectorLinkModel` lists them. */
  const linksOf = vi.fn();
  let agentModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectorMemberManage.mockResolvedValue('all_members');
    connectorModelMock = {
      copyToAgent: vi.fn().mockResolvedValue({ id: 'copied' }),
      create: vi.fn().mockResolvedValue({ id: 'created' }),
      createUnlessIdentifierHeld: vi.fn().mockResolvedValue({ created: { id: 'created' } }),
      findById: vi.fn(),
      findScopedByIdentifier: vi.fn().mockResolvedValue(null),
      changeVisibilityUnlessHeld: vi.fn().mockResolvedValue({ changed: true }),
      getLinkModel: () => ({ listByConnectorIds: linksOf }),
      update: vi.fn(),
    };
    linksOf.mockReset().mockResolvedValue([]);
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
      expect(connectorModelMock.createUnlessIdentifierHeld).toHaveBeenCalledWith(
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

      expect(connectorModelMock.createUnlessIdentifierHeld).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { avatar: '🔌' } }),
      );
    });

    it("never mounts a connector a member adds on a teammate's agent", async () => {
      // Regression: under `all_members`, a member added a shared connector
      // naming a teammate's private agent as its mount, under the identifier of
      // the owner's private connector. The mount outranked the owner's row, so
      // the agent sent its tool calls to the member's server. Only
      // mountToAgent mounts, after checking who created the agent.
      await member().create({
        ...createInput,
        metadata: { avatar: '🔌', mountedByAgentId: 'agt-victim' },
      });

      expect(connectorModelMock.createUnlessIdentifierHeld).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { avatar: '🔌' }, visibility: 'public' }),
      );
    });

    it('shares by default, and stores personal rows as shared', async () => {
      await member().create(createInput);
      await callerFor({}).create({ ...createInput, visibility: 'private' });

      expect(connectorModelMock.createUnlessIdentifierHeld).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ visibility: 'public' }),
      );
      expect(connectorModelMock.createUnlessIdentifierHeld).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ visibility: 'public' }),
      );
    });
    it("keeps a re-added row's Composio account, so its legacy projection stays withheld", async () => {
      // Regression: re-adding a private Composio connector cleared its account
      // block. The legacy plugin projection then held the account alone, and
      // workspace agents ran the private connection through the fallback.
      const composio = { connectedAccountId: 'acc-private', linkedByUserId: 'me' };
      connectorModelMock.findScopedByIdentifier.mockResolvedValue({
        agentId: null,
        id: 'mine',
        metadata: { avatar: '🔌', composio },
        userId: 'me',
        visibility: 'private',
      });
      connectorModelMock.update.mockResolvedValue({ id: 'mine' });

      await member().create({
        ...createInput,
        metadata: { avatar: '🛠', composio: { connectedAccountId: 'acc-forged' } },
        visibility: 'private',
      });

      expect(connectorModelMock.update).toHaveBeenCalledWith(
        'mine',
        expect.objectContaining({ metadata: { avatar: '🛠', composio } }),
      );
    });

    it('claims a private row within its visibility and re-adds over the holder it finds', async () => {
      // A concurrent add of the same private connector won the claim: this add
      // rewrites that row instead of inserting a second one.
      connectorModelMock.createUnlessIdentifierHeld.mockResolvedValue({
        holder: { agentId: null, id: 'held', metadata: null, userId: 'me', visibility: 'private' },
      });
      connectorModelMock.update.mockResolvedValue({ id: 'held' });

      await expect(member().create({ ...createInput, visibility: 'private' })).resolves.toEqual({
        id: 'held',
        isNew: false,
      });
      expect(connectorModelMock.createUnlessIdentifierHeld).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'my-mcp', visibility: 'private' }),
      );
      expect(connectorModelMock.update).toHaveBeenCalledWith('held', expect.anything());
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

  describe('unbindAgent', () => {
    const agentRow = (visibility: 'private' | 'public') => ({
      agentId: 'agt-mine',
      id: CONNECTOR_ID,
      identifier: 'my-mcp',
      metadata: null,
      userId: 'me',
      visibility,
    });

    it('returns a private agent row to the base scope beside a shared sibling', async () => {
      // Regression: the base-slot check looked among shared rows only, so the
      // shared connector of the same identifier blocked the private row's
      // return with CONFLICT although its private slot was empty. The move
      // looks for a holder in the row's own visibility (see the model).
      connectorModelMock.findById.mockResolvedValue(agentRow('private'));
      connectorModelMock.moveToBaseUnlessIdentifierHeld = vi
        .fn()
        .mockResolvedValue({ moved: true });

      await expect(member().unbindAgent({ connectorId: CONNECTOR_ID })).resolves.toEqual({
        id: CONNECTOR_ID,
      });
      expect(connectorModelMock.moveToBaseUnlessIdentifierHeld).toHaveBeenCalledWith(
        CONNECTOR_ID,
        'my-mcp',
      );
    });

    it('still refuses to return a row into an occupied slot of its visibility', async () => {
      connectorModelMock.findById.mockResolvedValue(agentRow('public'));
      connectorModelMock.moveToBaseUnlessIdentifierHeld = vi
        .fn()
        .mockResolvedValue({ holder: { id: 'base-row' } });

      await expect(member().unbindAgent({ connectorId: CONNECTOR_ID })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(connectorModelMock.update).not.toHaveBeenCalled();
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

      expect(connectorModelMock.changeVisibilityUnlessHeld).toHaveBeenCalledWith(
        CONNECTOR_ID,
        'my-mcp',
        'private',
      );
    });

    it('refuses when the destination slot was taken meanwhile', async () => {
      // Regression: two members sharing private connectors of one identifier
      // at once both passed the separate slot lookup and both became shared
      connectorModelMock.findById.mockResolvedValue(row({ visibility: 'private' }));
      vi.spyOn(mocks, 'getConnectorMemberManage').mockResolvedValue('all_members');
      connectorModelMock.changeVisibilityUnlessHeld.mockResolvedValue({ holder: { id: 'other' } });

      await expect(
        member().update({ id: CONNECTOR_ID, patch: { visibility: 'public' } }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(connectorModelMock.update).not.toHaveBeenCalled();
    });

    it('lets the member who linked a Composio account make it private', async () => {
      connectorModelMock.findById.mockResolvedValue(
        row({ metadata: { composio: { connectedAccountId: 'acc-1', linkedByUserId: 'me' } } }),
      );

      await member().update({ id: CONNECTOR_ID, patch: { visibility: 'private' } });

      expect(connectorModelMock.changeVisibilityUnlessHeld).toHaveBeenCalledWith(
        CONNECTOR_ID,
        'my-mcp',
        'private',
      );
    });

    it.each([
      ['a workspace agent', 'public', true],
      ["a teammate's private agent", 'private', false],
    ] as const)(
      'refuses to make private a connector mounted on %s',
      async (_label, agentVisibility, owned) => {
        // Regression: the switch succeeded, run scoping then dropped the row
        // from the agent it is mounted on, and its configured tool vanished.
        connectorModelMock.findById.mockResolvedValue(
          row({ metadata: { mountedByAgentId: 'agt-mounted' } }),
        );
        agentModelMock.getAgentVisibility.mockResolvedValue(agentVisibility);
        agentModelMock.existsOwnedById.mockResolvedValue(owned);

        await expect(
          member().update({ id: CONNECTOR_ID, patch: { visibility: 'private' } }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect(connectorModelMock.update).not.toHaveBeenCalled();
      },
    );

    it('makes private a connector mounted on its creator’s own private agent', async () => {
      connectorModelMock.findById.mockResolvedValue(
        row({ metadata: { mountedByAgentId: 'agt-mine' } }),
      );

      await member().update({ id: CONNECTOR_ID, patch: { visibility: 'private' } });

      expect(connectorModelMock.changeVisibilityUnlessHeld).toHaveBeenCalledWith(
        CONNECTOR_ID,
        'my-mcp',
        'private',
      );
    });

    it('refuses to make private a connector holding an account a teammate authorized', async () => {
      // Regression: only Composio's linker was checked, so a creator could make
      // private a shared OAuth connector a teammate had authorized and run the
      // teammate's token from their own private agent.
      connectorModelMock.findById.mockResolvedValue(row());
      linksOf.mockResolvedValue([
        { id: 'lnk_me', userId: 'me' },
        { id: 'lnk_mate', userId: 'mate' },
      ]);

      await expect(
        member().update({ id: CONNECTOR_ID, patch: { visibility: 'private' } }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(linksOf).toHaveBeenCalledWith([CONNECTOR_ID]);
      expect(connectorModelMock.update).not.toHaveBeenCalled();
    });

    it('makes private a connector whose accounts are all the creator’s own', async () => {
      connectorModelMock.findById.mockResolvedValue(row());
      linksOf.mockResolvedValue([{ id: 'lnk_me', userId: 'me' }]);

      await member().update({ id: CONNECTOR_ID, patch: { visibility: 'private' } });

      expect(connectorModelMock.changeVisibilityUnlessHeld).toHaveBeenCalledWith(
        CONNECTOR_ID,
        'my-mcp',
        'private',
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

    it('never mounts a connector through an edit', async () => {
      connectorModelMock.findById.mockResolvedValue(row({ metadata: { avatar: '🔌' } }));

      await member().update({
        id: CONNECTOR_ID,
        patch: { metadata: { avatar: '🔌', mountedByAgentId: 'agt-victim' } },
      });

      expect(connectorModelMock.update).toHaveBeenCalledWith(
        CONNECTOR_ID,
        expect.objectContaining({ metadata: { avatar: '🔌' } }),
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
