// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import {
  userConnectors,
  userConnectorTools,
  userInstalledPlugins,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';
import { mcpService } from '@/server/services/mcp';

import {
  installMarketplaceMcpConnector,
  type MarketMcpManifest,
  MARKETPLACE_INSTALL_LEASE_MS,
  pickMarketplaceDeployment,
} from './marketplaceInstall';
import { buildConnectorMcpParams } from './sync';

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
        // The listing's endpoint is reached over the SSRF-safe transport
        ssrfSafe: true,
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
      ssrfSafeTransport: true,
    });
    expect(await pluginRows()).toEqual([]);
  });

  it('keeps every later call to an HTTP install on the SSRF-safe transport', async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([{ name: 'search' }] as never);
    await installMarketplaceMcpConnector(scope, 'remote-mcp', httpManifest);

    const [row] = await connectorRows();
    const connector = (await new ConnectorModel(db, userId).findById(row.id))!;
    const tools = await db.select().from(userConnectorTools);

    // A conversation's tool calls (`toolExecution` runs the manifest's params),
    // and the `connector.callTool` / view / re-sync paths (`buildConnectorMcpParams`)
    expect(buildConnectorManifests([connector], tools)).toEqual([
      expect.objectContaining({ mcpParams: expect.objectContaining({ ssrfSafe: true }) }),
    ]);
    expect(buildConnectorMcpParams(connector)).toMatchObject({ ssrfSafe: true, type: 'http' });
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

  it('creates the connector once for concurrent installs of one server', async () => {
    const outcomes = await Promise.all([
      installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest),
      installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'installed')).toHaveLength(1);
    const rows = await connectorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ marketplaceInstalled: true });
    expect(await db.select().from(userConnectorTools)).toHaveLength(2);
  });

  describe('over an unfinished marketplace install', () => {
    const staleAt = () => new Date(Date.now() - MARKETPLACE_INSTALL_LEASE_MS - 60_000);
    const seedUnfinished = async (row: Partial<typeof userConnectors.$inferInsert> = {}) => {
      const [seeded] = await db
        .insert(userConnectors)
        .values({
          identifier: 'fetch-mcp',
          mcpConnectionType: 'cloud',
          metadata: { cloudEndPoint: true },
          name: 'Interrupted',
          sourceType: 'marketplace',
          status: 'disconnected',
          userId,
          ...row,
        })
        .returning();
      return seeded;
    };

    it('reports an install still inside its lease as in progress and leaves it', async () => {
      const seeded = await seedUnfinished();

      expect(await installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest)).toEqual({
        blocker: 'in-progress',
        status: 'blocked',
      });
      expect(await connectorRows()).toEqual([seeded]);
    });

    it('takes over an interrupted install once its lease has run out', async () => {
      const seeded = await seedUnfinished({ updatedAt: staleAt() });
      await db.insert(userConnectorTools).values({
        crudType: 'read',
        permission: 'auto',
        toolName: 'half-synced',
        userConnectorId: seeded.id,
        userId,
      });

      expect(await installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest)).toEqual({
        status: 'installed',
      });
      const [connector] = await connectorRows();
      expect(connector.id).not.toBe(seeded.id);
      expect(connector).toMatchObject({ name: 'Fetch', status: 'connected' });
      expect(connector.metadata).toMatchObject({ marketplaceInstalled: true });
      expect(
        (await db.select().from(userConnectorTools)).map((tool) => tool.toolName).sort(),
      ).toEqual(['fetch', 'purge']);
    });

    it('leaves a connected pre-connector install its bare plugin row makes callable', async () => {
      const seeded = await seedUnfinished({ status: 'connected', updatedAt: staleAt() });
      await db
        .insert(userInstalledPlugins)
        .values({ identifier: 'fetch-mcp', type: 'plugin', userId });

      expect(await installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest)).toEqual({
        status: 'exists',
      });
      expect(await connectorRows()).toEqual([seeded]);
    });

    it('takes over an interrupted install a bare plugin row cannot make callable', async () => {
      // A manifest-less plugin row only lets runs call a connected row
      const seeded = await seedUnfinished({ updatedAt: staleAt() });
      await db
        .insert(userInstalledPlugins)
        .values({ identifier: 'fetch-mcp', type: 'plugin', userId });

      expect(await installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest)).toEqual({
        status: 'installed',
      });
      const [connector] = await connectorRows();
      expect(connector.id).not.toBe(seeded.id);
      expect(connector.metadata).toMatchObject({ marketplaceInstalled: true });
    });
  });

  it.each([
    ['a custom connector', { sourceType: 'custom' }],
    // A row without an endpoint only projects tools another executor runs
    [
      'an endpoint-less marketplace row',
      { mcpConnectionType: null, mcpServerUrl: null, sourceType: 'marketplace' },
    ],
  ])('refuses to overwrite %s of the same identifier', async (_, row) => {
    await db.insert(userConnectors).values({
      identifier: 'fetch-mcp',
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mcp.example.com/mcp',
      name: 'Existing',
      status: 'disconnected',
      // Past the lease, so only the kind of row keeps it
      updatedAt: new Date(Date.now() - MARKETPLACE_INSTALL_LEASE_MS - 60_000),
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

    it("leaves another member's interrupted install for them or an admin to remove", async () => {
      await seedWorkspace('all_members');
      await db.insert(userConnectors).values({
        identifier: 'fetch-mcp',
        mcpConnectionType: 'cloud',
        name: 'Interrupted',
        sourceType: 'marketplace',
        status: 'disconnected',
        updatedAt: new Date(Date.now() - MARKETPLACE_INSTALL_LEASE_MS - 60_000),
        userId,
        workspaceId,
      });
      const before = await connectorRows();

      expect(
        await installMarketplaceMcpConnector(
          { serverDB: db, userId: memberId, workspaceId },
          'fetch-mcp',
          cloudManifest,
        ),
      ).toEqual({ blocker: 'conflict', status: 'blocked' });
      expect(await connectorRows()).toEqual(before);
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
