// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  userConnectors,
  userConnectorTools,
  userInstalledPlugins,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import { mcpService } from '@/server/services/mcp';

import {
  installMarketplaceMcpConnector,
  type MarketMcpManifest,
  pickMarketplaceDeployment,
} from './marketplaceInstall';

vi.mock('@/server/services/mcp', () => ({ mcpService: { listRawTools: vi.fn() } }));
vi.mock('@/server/services/mcp/featureGate', () => ({
  isMcpAppsEnabled: vi.fn().mockResolvedValue(false),
}));

const db = await getTestDB();
const userId = 'market-install-user';
const memberId = 'market-install-member';
const workspaceId = 'market-install-ws';

const stdioOption = { connection: { args: ['-y', 'fetch-mcp'], command: 'npx', type: 'stdio' } };
const httpOption = (connection: Record<string, unknown> = {}) => ({
  connection: { type: 'http', url: 'https://mcp.example.com/mcp', ...connection },
});

const cloudManifest: MarketMcpManifest = {
  deploymentOptions: [stdioOption],
  description: 'Fetch web pages',
  haveCloudEndpoint: true,
  icon: 'https://example.com/icon.png',
  name: 'Fetch',
  tools: [
    { description: 'Fetch a URL', inputSchema: { type: 'object' }, name: 'fetch' },
    { description: 'Delete a cache entry', name: 'purge' },
  ],
  version: '1.2.0',
};

const httpManifest: MarketMcpManifest = {
  deploymentOptions: [httpOption()],
  name: 'Remote MCP',
  version: '0.3.0',
};

const scope = { serverDB: db, userId };

const connectorRows = () => db.select().from(userConnectors);
const pluginRows = () => db.select().from(userInstalledPlugins);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: memberId }]);
});

afterEach(async () => {
  await db.delete(users);
});

describe('pickMarketplaceDeployment', () => {
  it('uses the market-hosted endpoint of a stdio server first, as the web install does', () => {
    expect(
      pickMarketplaceDeployment({
        deploymentOptions: [httpOption(), stdioOption],
        haveCloudEndpoint: 'https://cloud.example.com',
      }),
    ).toEqual({
      deployment: { cloudEndPoint: 'https://cloud.example.com', headers: undefined, type: 'cloud' },
    });
  });

  it('uses an HTTP endpoint, typed or untyped', () => {
    expect(pickMarketplaceDeployment({ deploymentOptions: [stdioOption, httpOption()] })).toEqual({
      deployment: {
        auth: undefined,
        headers: undefined,
        type: 'http',
        url: 'https://mcp.example.com/mcp',
      },
    });
    expect(
      pickMarketplaceDeployment({ deploymentOptions: [{ connection: { url: 'https://a.dev' } }] }),
    ).toMatchObject({ deployment: { type: 'http', url: 'https://a.dev' } });
  });

  it.each([
    ['a stdio-only server', { deploymentOptions: [stdioOption] }, 'local-only'],
    ['no deployment options', {}, 'local-only'],
    [
      'an OAuth HTTP server',
      { deploymentOptions: [httpOption({ auth: { type: 'oauth2' } })] },
      'oauth',
    ],
    [
      'an HTTP server that needs config',
      {
        deploymentOptions: [
          httpOption({ configSchema: { properties: { KEY: {} }, required: ['KEY'] } }),
        ],
      },
      'config',
    ],
    [
      'a hosted server that needs config',
      {
        deploymentOptions: [
          {
            connection: {
              ...stdioOption.connection,
              configSchema: { properties: { KEY: { required: true } } },
            },
          },
        ],
        haveCloudEndpoint: true,
      },
      'config',
    ],
  ])('refuses %s', (_, manifest, blocker) => {
    expect(pickMarketplaceDeployment(manifest as MarketMcpManifest)).toEqual({ blocker });
  });
});

describe('installMarketplaceMcpConnector', () => {
  it('stores a hosted server as a marked cloud connector with its manifest tools', async () => {
    const outcome = await installMarketplaceMcpConnector(scope, 'fetch-mcp', {
      ...cloudManifest,
      api: [
        { description: 'Fetch a URL', name: 'fetch', parameters: { type: 'object' } },
        { description: 'Purge', humanIntervention: 'required', name: 'purge', parameters: {} },
      ],
    });

    expect(outcome).toEqual({ status: 'installed' });
    expect(await pluginRows()).toEqual([]);
    const [connector, ...others] = await connectorRows();
    expect(others).toEqual([]);
    expect(connector).toMatchObject({
      agentId: null,
      identifier: 'fetch-mcp',
      isEnabled: true,
      mcpConnectionType: 'cloud',
      mcpServerUrl: null,
      name: 'Fetch',
      sourceType: 'marketplace',
      status: 'connected',
    });
    expect(connector.metadata).toEqual({
      avatar: 'https://example.com/icon.png',
      cloudEndPoint: true,
      description: 'Fetch web pages',
      marketplaceInstalled: true,
      version: '1.2.0',
    });

    const tools = await db
      .select()
      .from(userConnectorTools)
      .where(eq(userConnectorTools.userConnectorId, connector.id));
    expect(
      tools
        .map(({ permission, toolName }) => ({ permission, toolName }))
        .sort((a, b) => a.toolName.localeCompare(b.toolName)),
    ).toEqual([
      { permission: 'auto', toolName: 'fetch' },
      // The manifest's `humanIntervention` carries over, as in the web install
      { permission: 'needs_approval', toolName: 'purge' },
    ]);
    expect(mcpService.listRawTools).not.toHaveBeenCalled();
  });

  it('stores an HTTP server as a marked connector with the tools it lists', async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([
      { description: 'Search', inputSchema: { type: 'object' }, name: 'search' },
    ] as never);

    const outcome = await installMarketplaceMcpConnector(scope, 'remote-mcp', {
      ...httpManifest,
      deploymentOptions: [httpOption({ headers: { 'X-Client': 'lobehub' } })],
    });

    expect(outcome).toEqual({ status: 'installed' });
    expect(mcpService.listRawTools).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'X-Client': 'lobehub' },
        name: 'remote-mcp',
        type: 'http',
        url: 'https://mcp.example.com/mcp',
      }),
      { mcpApps: false },
    );
    const [connector] = await connectorRows();
    expect(connector).toMatchObject({
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mcp.example.com/mcp',
      sourceType: 'marketplace',
      status: 'connected',
    });
    expect(connector.metadata).toMatchObject({
      customHeaders: { 'X-Client': 'lobehub' },
      marketplaceInstalled: true,
    });
    expect(await pluginRows()).toEqual([]);
  });

  it('removes the connector it created when the server cannot be reached', async () => {
    vi.mocked(mcpService.listRawTools).mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(installMarketplaceMcpConnector(scope, 'remote-mcp', httpManifest)).rejects.toThrow(
      'ECONNREFUSED',
    );

    expect(await connectorRows()).toEqual([]);
    expect(await pluginRows()).toEqual([]);
  });

  it('writes nothing for a server that lists no tools', async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([]);

    expect(await installMarketplaceMcpConnector(scope, 'remote-mcp', httpManifest)).toEqual({
      blocker: 'no-tools',
      status: 'blocked',
    });
    expect(
      await installMarketplaceMcpConnector(scope, 'fetch-mcp', { ...cloudManifest, tools: [] }),
    ).toEqual({ blocker: 'no-tools', status: 'blocked' });
    expect(await connectorRows()).toEqual([]);
  });

  it('writes nothing for a server only the user can install', async () => {
    expect(
      await installMarketplaceMcpConnector(scope, 'local-mcp', {
        deploymentOptions: [stdioOption],
      }),
    ).toEqual({ blocker: 'local-only', status: 'blocked' });
    expect(await connectorRows()).toEqual([]);
  });

  it('leaves a finished install as it is', async () => {
    await installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest);
    const [before] = await connectorRows();

    expect(await installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest)).toEqual({
      status: 'exists',
    });
    expect(await connectorRows()).toEqual([before]);
  });

  it.each([
    ['a custom connector', { sourceType: 'custom' }],
    // A web install that never finished (its OAuth was canceled) is not overwritten
    [
      'an unfinished marketplace install',
      { mcpServerUrl: 'https://mcp.example.com/mcp', sourceType: 'marketplace' },
    ],
  ])('refuses to overwrite %s of the same identifier', async (_, row) => {
    await db.insert(userConnectors).values({
      identifier: 'fetch-mcp',
      mcpConnectionType: 'http',
      name: 'Existing',
      status: 'disconnected',
      userId,
      ...row,
    } as typeof userConnectors.$inferInsert);
    const [before] = await connectorRows();

    expect(await installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest)).toEqual({
      blocker: 'conflict',
      status: 'blocked',
    });
    expect(await connectorRows()).toEqual([before]);
  });

  describe('in a workspace', () => {
    const seedWorkspace = async (memberManage: 'admins_only' | 'all_members') => {
      await db.insert(workspaces).values({
        id: workspaceId,
        name: 'Team',
        primaryOwnerId: userId,
        settings: { connector: { memberManage } },
        slug: 'market-install-team',
      });
      await db.insert(workspaceMembers).values([
        { role: 'owner', userId, workspaceId },
        { role: 'member', userId: memberId, workspaceId },
      ]);
    };

    afterEach(async () => {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    });

    it('lets a member add the connector when members manage connectors', async () => {
      await seedWorkspace('all_members');

      expect(
        await installMarketplaceMcpConnector(
          { serverDB: db, userId: memberId, workspaceId },
          'fetch-mcp',
          cloudManifest,
        ),
      ).toEqual({ status: 'installed' });
      expect(await connectorRows()).toEqual([
        expect.objectContaining({ userId: memberId, workspaceId }),
      ]);
    });

    it('applies the admins-only connector policy', async () => {
      await seedWorkspace('admins_only');

      expect(
        await installMarketplaceMcpConnector(
          { serverDB: db, userId: memberId, workspaceId },
          'fetch-mcp',
          cloudManifest,
        ),
      ).toEqual({ blocker: 'forbidden', status: 'blocked' });
      expect(await connectorRows()).toEqual([]);

      expect(
        await installMarketplaceMcpConnector(
          { serverDB: db, userId, workspaceId },
          'fetch-mcp',
          cloudManifest,
        ),
      ).toEqual({ status: 'installed' });
    });
  });
});
