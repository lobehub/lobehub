// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorLinkModel } from '@/database/models/connectorLink';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { toolSetsFrom } from '@/server/services/aiAgent/__tests__/helpers/connectorToolSets';

import { connectorRouter } from './connector';

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorLink', () => ({ ConnectorLinkModel: vi.fn() }));
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

describe('connectorRouter.getForRun', () => {
  const resolveByIdentifiers = vi.fn();
  const existsById = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AgentModel).mockImplementation(function () {
      return { existsById } as never;
    });
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return { resolveByIdentifiers, resolveToolSets: toolSetsFrom(resolveByIdentifiers) } as never;
    });
    vi.mocked(ConnectorToolModel).mockImplementation(function () {
      return { queryByConnector } as never;
    });
    existsById.mockResolvedValue(true);
    resolveByIdentifiers.mockResolvedValue([connector]);
    queryByConnector.mockResolvedValue(tools);
  });

  const caller = (userId: string) =>
    connectorRouter.createCaller({
      serverDB: {},
      userId,
      workspaceId: 'workspace',
      workspaceRole: 'member',
    } as never);

  const input = { agentId: 'agent-private', identifier: 'local-mcp', topicId: 'topic-group' };

  it('returns the row the conversation resolves on the server, not one the client picked', async () => {
    // A desktop runs a stdio connector itself. Only the server can tell a
    // private agent's own topic from a group topic, so it names the row.
    await expect(caller('creator').getForRun(input)).resolves.toMatchObject({
      id: connector.id,
      mcpStdioConfig: connector.mcpStdioConfig,
      tools,
    });

    expect(resolveByIdentifiers).toHaveBeenCalledWith(['local-mcp'], {
      agentId: 'agent-private',
      topicId: 'topic-group',
    });
    // A private agent may resolve its owner's personal connector, whose tools
    // live in the personal scope.
    expect(ConnectorToolModel).toHaveBeenCalledWith(expect.anything(), 'creator', 'workspace', {
      agentRun: true,
    });
  });

  it('resolves nothing for an agent the caller cannot see', async () => {
    existsById.mockResolvedValue(false);

    await expect(caller('creator').getForRun(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(resolveByIdentifiers).not.toHaveBeenCalled();
  });

  it('keeps the resolved configuration behind the creator gate', async () => {
    await expect(caller('another-member').getForRun(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(queryByConnector).not.toHaveBeenCalled();
  });
});

describe('connectorRouter.resolveForRun', () => {
  const resolveByIdentifiers = vi.fn();
  const existsById = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AgentModel).mockImplementation(function () {
      return { existsById } as never;
    });
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return { resolveByIdentifiers, resolveToolSets: toolSetsFrom(resolveByIdentifiers) } as never;
    });
    vi.mocked(ConnectorToolModel).mockImplementation(function () {
      return { queryByConnector } as never;
    });
    existsById.mockResolvedValue(true);
    resolveByIdentifiers.mockResolvedValue([connector]);
    queryByConnector.mockResolvedValue(tools);
  });

  const caller = (userId: string) =>
    connectorRouter.createCaller({
      serverDB: {},
      userId,
      workspaceId: 'workspace',
      workspaceRole: 'viewer',
    } as never);

  const input = { agentId: 'agent-private', identifier: 'local-mcp', topicId: 'topic-group' };

  it('names the row the conversation runs on, with its transport but not its configuration', async () => {
    // Any member who can call the tool may ask: the answer routes the call and
    // judges its approval, never the creator-gated stdio command and env that
    // getForRun returns.
    await expect(caller('another-member').resolveForRun(input)).resolves.toEqual({
      agentId: undefined,
      id: connector.id,
      identifier: 'local-mcp',
      isEnabled: true,
      links: [],
      mcpConnectionType: 'stdio',
      mcpServerUrl: undefined,
      metadata: {},
      sourceType: undefined,
      status: undefined,
      toolIdentifier: 'local-mcp',
      tools,
    });
    expect(resolveByIdentifiers).toHaveBeenCalledWith(['local-mcp'], {
      agentId: 'agent-private',
      topicId: 'topic-group',
    });
  });

  it("lists the accounts of the owner's personal connector a private agent runs", async () => {
    // The workspace scope cannot list a personal row's accounts; without them
    // a desktop's local call could not tell that the model must name one.
    const account = (id: string) => ({
      createdAt: new Date('2026-01-01T00:00:00Z'),
      credentials: { accessToken: id, type: 'oauth2' },
      id,
      name: id,
      status: 'connected',
      userConnectorId: 'personal-row',
      userId: 'creator',
    });
    const personalLinks = {
      listByConnectorIds: vi.fn().mockResolvedValue([account('lnk_a'), account('lnk_b')]),
    };
    const personalModel = {
      forRow() {
        return this;
      },
      getLinkModel: () => personalLinks,
    };
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return {
        forRow: () => personalModel,
        resolveByIdentifiers,
        resolveToolSets: toolSetsFrom(resolveByIdentifiers),
      } as never;
    });
    resolveByIdentifiers.mockResolvedValue([
      {
        ...connector,
        credentials: null,
        id: 'personal-row',
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://nas.tail1234.ts.net/mcp',
        oidcConfig: { clientId: 'client', scheme: 'dcr' },
        workspaceId: null,
      },
    ]);

    const answer = await caller('creator').resolveForRun(input);

    expect(answer?.links.map((link) => link.id)).toEqual(['lnk_a', 'lnk_b']);
    expect(personalLinks.listByConnectorIds).toHaveBeenCalledWith(['personal-row']);
  });

  it("reads the tools of the owner's personal connector a private agent runs", async () => {
    // Regression: the client's workspace lists never hold a personal row, so a
    // desktop could not tell that the call runs a stdio connector and sent it
    // to the server, which cannot run one.
    await caller('creator').resolveForRun(input);

    expect(ConnectorToolModel).toHaveBeenCalledWith(expect.anything(), 'creator', 'workspace', {
      agentRun: true,
    });
    expect(queryByConnector).toHaveBeenCalledWith(connector.id);
  });

  it('carries the install state the client routes by, and no other metadata', async () => {
    // A personal marketplace stdio install keeps running on the desktop under a
    // device gateway, and an unfinished install is not run: the client reads
    // both off this answer for a row its lists lack.
    resolveByIdentifiers.mockResolvedValue([
      {
        ...connector,
        agentId: null,
        metadata: {
          composio: { connectedAccountId: 'ca-1' },
          description: 'Local files',
          marketplaceInstalled: true,
        },
        sourceType: 'marketplace',
        status: 'connected',
      },
    ]);

    await expect(caller('creator').resolveForRun(input)).resolves.toMatchObject({
      agentId: null,
      metadata: { marketplaceInstalled: true },
      sourceType: 'marketplace',
      status: 'connected',
    });
    const answer = await caller('creator').resolveForRun(input);
    expect(answer?.metadata).toEqual({ marketplaceInstalled: true });
  });

  it('carries where an HTTP server is reached from, so a personal one runs on its device', async () => {
    // Regression: a private agent's own topic may run its owner's personal HTTP
    // connector, which no workspace list on the client holds. Without
    // `connectVia`, a public-looking address set to connect through the device
    // (Tailscale MagicDNS) routed to the server, which refuses it; without
    // `boundDeviceId`, one bound to another device was run here.
    resolveByIdentifiers.mockResolvedValue([
      {
        ...connector,
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://nas.tail1234.ts.net/mcp',
        metadata: { boundDeviceId: 'laptop', connectVia: 'device', description: 'NAS' },
      },
    ]);

    const answer = await caller('creator').resolveForRun(input);

    expect(answer?.metadata).toEqual({ boundDeviceId: 'laptop', connectVia: 'device' });
  });

  it('answers null when the conversation resolves no row', async () => {
    resolveByIdentifiers.mockResolvedValue([]);
    await expect(caller('creator').resolveForRun(input)).resolves.toBeNull();

    existsById.mockResolvedValue(false);
    await expect(caller('creator').resolveForRun(input)).resolves.toBeNull();
  });
});

describe('connectorRouter.getLocalCallToken', () => {
  const resolveByIdentifiers = vi.fn();
  const findById = vi.fn();
  const existsById = vi.fn();
  // A personal OAuth HTTP connector on a tailnet, set to connect through the device
  const personal = {
    credentials: null,
    id: '9f1f6f30-0000-4000-8000-00000000000a',
    identifier: 'nas',
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://nas.tail1234.ts.net/mcp',
    metadata: { connectVia: 'device' },
    oidcConfig: { clientId: 'client', scheme: 'dcr' },
    userId: 'creator',
    workspaceId: null,
  };
  const account = {
    credentials: { accessToken: 'personal-access', type: 'oauth2' },
    id: 'lnk_personal',
    name: 'Personal',
    status: 'connected',
    userConnectorId: personal.id,
    userId: 'creator',
  };
  // Accounts are listed per scope: the workspace's, or the creator's personal one
  const workspaceLinks = { listByConnectorIds: vi.fn() };
  const personalLinks = { listByConnectorIds: vi.fn() };
  const personalModel = {
    forRow() {
      return this;
    },
    getLinkModel: () => personalLinks,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AgentModel).mockImplementation(function () {
      return { existsById } as never;
    });
    vi.mocked(ConnectorModel).mockImplementation(function () {
      const model = {
        findById,
        forRow: (row: { workspaceId: string | null }) =>
          row.workspaceId === null ? personalModel : model,
        getLinkModel: () => workspaceLinks,
        resolveByIdentifiers,
        resolveToolSets: toolSetsFrom(resolveByIdentifiers),
      };
      return model as never;
    });
    vi.mocked(ConnectorLinkModel).mockImplementation(function () {
      return workspaceLinks as never;
    });
    existsById.mockResolvedValue(true);
    resolveByIdentifiers.mockResolvedValue([personal]);
    // The workspace scope can read neither a personal row by id nor its accounts
    findById.mockResolvedValue(null);
    workspaceLinks.listByConnectorIds.mockResolvedValue([]);
    personalLinks.listByConnectorIds.mockResolvedValue([account]);
  });

  const caller = (userId: string) =>
    connectorRouter.createCaller({
      serverDB: {},
      userId,
      workspaceId: 'workspace',
      workspaceRole: 'member',
    } as never);

  const run = { agentId: 'agent-private', identifier: 'nas', topicId: 'topic-own' };

  it("returns the token of the personal connector a private agent's conversation runs", async () => {
    // Regression: `getForRun` returned the owner's personal row for a private
    // agent's own topic, but the token was looked up by id in the workspace
    // scope, which cannot find it, so the desktop call failed with NOT_FOUND.
    await expect(caller('creator').getLocalCallToken({ id: personal.id, run })).resolves.toEqual({
      accessToken: 'personal-access',
      type: 'oauth2',
    });
    expect(resolveByIdentifiers).toHaveBeenCalledWith(['nas'], {
      agentId: 'agent-private',
      topicId: 'topic-own',
    });
    expect(findById).not.toHaveBeenCalled();
    expect(personalLinks.listByConnectorIds).toHaveBeenCalledWith([personal.id]);
    expect(workspaceLinks.listByConnectorIds).not.toHaveBeenCalled();
  });

  it('refuses a row the conversation does not run', async () => {
    // A group topic resolves the shared row: a private connector's token is not its own
    resolveByIdentifiers.mockResolvedValue([{ ...personal, id: 'shared-row' }]);

    await expect(
      caller('creator').getLocalCallToken({ id: personal.id, run }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('resolves nothing for an agent the caller cannot see', async () => {
    existsById.mockResolvedValue(false);

    await expect(
      caller('creator').getLocalCallToken({ id: personal.id, run }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(resolveByIdentifiers).not.toHaveBeenCalled();
  });

  it('keeps the token behind the creator gate', async () => {
    await expect(
      caller('another-member').getLocalCallToken({ id: personal.id, run }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("reads a row of the caller's scope by id outside a conversation", async () => {
    findById.mockResolvedValue({ ...personal, workspaceId: 'workspace' });
    workspaceLinks.listByConnectorIds.mockResolvedValue([account]);

    await expect(caller('creator').getLocalCallToken({ id: personal.id })).resolves.toEqual({
      accessToken: 'personal-access',
      type: 'oauth2',
    });
    expect(findById).toHaveBeenCalledWith(personal.id);
    expect(resolveByIdentifiers).not.toHaveBeenCalled();
  });
});
