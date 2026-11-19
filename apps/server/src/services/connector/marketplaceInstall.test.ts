// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
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
import { listMcpToolsOnDevice } from '@/server/services/mcp/deviceTunnel';

import {
  installMarketplaceMcpConnector,
  type MarketMcpManifest,
  MARKETPLACE_INSTALL_LEASE_MS,
  pickMarketplaceDeployment,
} from './marketplaceInstall';
import { syncConnectorToolsById } from './sync';

vi.mock('@/server/services/mcp', () => ({ mcpService: { listRawTools: vi.fn() } }));
const gateway = vi.hoisted(() => ({ isConfigured: false }));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: gateway }));
vi.mock('@/server/services/mcp/deviceTunnel', () => ({ listMcpToolsOnDevice: vi.fn() }));
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
  gateway.isConfigured = false;
  await db.delete(users);
});

describe('pickMarketplaceDeployment', () => {
  const noGateway = { deviceGatewayConfigured: false };
  const withGateway = { deviceGatewayConfigured: true };

  it('uses the market-hosted endpoint of a stdio server first, as the web install does', () => {
    expect(
      pickMarketplaceDeployment(
        {
          deploymentOptions: [httpOption(), stdioOption],
          haveCloudEndpoint: 'https://cloud.example.com',
        },
        noGateway,
      ),
    ).toEqual({
      deployment: { cloudEndPoint: 'https://cloud.example.com', headers: undefined, type: 'cloud' },
    });
  });

  it('uses an HTTP endpoint, typed or untyped', () => {
    expect(
      pickMarketplaceDeployment({ deploymentOptions: [stdioOption, httpOption()] }, withGateway),
    ).toEqual({
      deployment: {
        auth: undefined,
        headers: undefined,
        type: 'http',
        url: 'https://mcp.example.com/mcp',
      },
    });
    expect(
      pickMarketplaceDeployment(
        { deploymentOptions: [{ connection: { url: 'https://a.dev' } }] },
        withGateway,
      ),
    ).toMatchObject({ deployment: { type: 'http', url: 'https://a.dev' } });
  });

  describe('an HTTP endpoint on localhost or a private network', () => {
    const privateUrls = [
      'http://localhost:3000/mcp',
      'http://127.0.0.1:8080/mcp',
      'http://10.0.0.2/mcp',
    ];

    it.each(privateUrls)(
      'is refused with a device gateway, which would reach %s from the user device',
      (url) => {
        expect(
          pickMarketplaceDeployment(
            { deploymentOptions: [stdioOption, httpOption({ url })] },
            withGateway,
          ),
        ).toEqual({ blocker: 'private-network' });
      },
    );

    it('gives way to one the server reaches', () => {
      expect(
        pickMarketplaceDeployment(
          {
            deploymentOptions: [
              httpOption({ url: 'http://192.168.1.10:8080/mcp' }),
              { connection: { url: 'https://a.dev' } },
            ],
          },
          withGateway,
        ),
      ).toMatchObject({ deployment: { type: 'http', url: 'https://a.dev' } });
    });

    it('is used without a gateway: the server connects itself, through the SSRF-safe fetch', () => {
      expect(
        pickMarketplaceDeployment(
          { deploymentOptions: [httpOption({ url: 'http://10.0.0.2/mcp' })] },
          noGateway,
        ),
      ).toMatchObject({ deployment: { type: 'http', url: 'http://10.0.0.2/mcp' } });
    });
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
    expect(pickMarketplaceDeployment(manifest as MarketMcpManifest, withGateway)).toEqual({
      blocker,
    });
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
      expect.objectContaining({ mcpApps: false }),
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

  it("keeps the approval the marketplace manifest asks for on an HTTP server's tools", async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([
      { name: 'search' },
      { name: 'send' },
      { name: 'delete' },
    ] as never);

    await installMarketplaceMcpConnector(scope, 'remote-mcp', {
      ...httpManifest,
      api: [
        { name: 'search', parameters: {} },
        { humanIntervention: 'required', name: 'send', parameters: {} },
        { humanIntervention: 'always', name: 'delete', parameters: {} },
      ],
    });

    const [row] = await connectorRows();
    const tools = await db
      .select()
      .from(userConnectorTools)
      .where(eq(userConnectorTools.userConnectorId, row.id));
    expect(
      tools
        .map(({ metadata, permission, toolName }) => ({ metadata, permission, toolName }))
        .sort((a, b) => a.toolName.localeCompare(b.toolName)),
    ).toEqual([
      // An `always` stays mandatory past auto-run
      { metadata: { mandatoryApproval: true }, permission: 'needs_approval', toolName: 'delete' },
      { metadata: null, permission: 'auto', toolName: 'search' },
      { metadata: null, permission: 'needs_approval', toolName: 'send' },
    ]);

    // Runs build the connector's manifest from those rows
    const connector = (await new ConnectorModel(db, userId).findById(row.id))!;
    const [manifest] = buildConnectorManifests([connector], tools);
    expect(
      Object.fromEntries(manifest.api.map((api) => [api.name, api.humanIntervention])),
    ).toEqual({ delete: 'always', search: undefined, send: 'required' });
  });

  it("keeps the approval a tools-format manifest asks for on an HTTP server's tools", async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([
      { name: 'search' },
      { name: 'delete' },
    ] as never);

    await installMarketplaceMcpConnector(scope, 'remote-mcp', {
      ...httpManifest,
      tools: [{ name: 'search' }, { humanIntervention: 'always', name: 'delete' }],
    });

    const tools = await db.select().from(userConnectorTools);
    expect(
      tools
        .map(({ metadata, permission, toolName }) => ({ metadata, permission, toolName }))
        .sort((a, b) => a.toolName.localeCompare(b.toolName)),
    ).toEqual([
      { metadata: { mandatoryApproval: true }, permission: 'needs_approval', toolName: 'delete' },
      { metadata: null, permission: 'auto', toolName: 'search' },
    ]);
  });

  it('keeps an `always` tool mandatory through the refreshes that follow the install', async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([
      { name: 'search' },
      { name: 'delete' },
    ] as never);
    await installMarketplaceMcpConnector(scope, 'remote-mcp', {
      ...httpManifest,
      api: [
        { name: 'search', parameters: {} },
        { humanIntervention: 'always', name: 'delete', parameters: {} },
      ],
    });
    const [row] = await connectorRows();

    // The background (and manual) refresh syncs the listing alone, without the manifest
    await syncConnectorToolsById(row.id, {
      connectorModel: new ConnectorModel(db, userId),
      connectorToolModel: new ConnectorToolModel(db, userId),
      serverDB: undefined,
      userId,
    });

    const tools = await db
      .select()
      .from(userConnectorTools)
      .where(eq(userConnectorTools.userConnectorId, row.id));
    const connector = (await new ConnectorModel(db, userId).findById(row.id))!;
    const [manifest] = buildConnectorManifests([connector], tools);
    // `always` is the approval auto-run and headless runs still ask for
    expect(
      Object.fromEntries(manifest.api.map((api) => [api.name, api.humanIntervention])),
    ).toEqual({ delete: 'always', search: undefined });
  });

  describe('a tool the marketplace manifest does not list', () => {
    const syncedTools = async () =>
      (await db.select().from(userConnectorTools))
        .map(({ metadata, permission, toolName }) => ({ metadata, permission, toolName }))
        .sort((a, b) => a.toolName.localeCompare(b.toolName));
    const runApprovals = async () => {
      const [row] = await connectorRows();
      const connector = (await new ConnectorModel(db, userId).findById(row.id))!;
      const [manifest] = buildConnectorManifests(
        [connector],
        await db.select().from(userConnectorTools),
      );
      return Object.fromEntries(manifest.api.map((api) => [api.name, api.humanIntervention]));
    };

    it('needs approval on every call from the install on', async () => {
      vi.mocked(mcpService.listRawTools).mockResolvedValue([
        { name: 'search' },
        { name: 'exfiltrate' },
      ] as never);

      await installMarketplaceMcpConnector(scope, 'remote-mcp', {
        ...httpManifest,
        tools: [{ name: 'search' }],
      });

      const [row] = await connectorRows();
      // The market's per-tool policies are kept for the syncs that follow
      expect(row.metadata).toMatchObject({ marketplaceToolPolicies: { search: null } });
      expect(await syncedTools()).toEqual([
        {
          metadata: { mandatoryApproval: true },
          permission: 'needs_approval',
          toolName: 'exfiltrate',
        },
        { metadata: null, permission: 'auto', toolName: 'search' },
      ]);
      // `always` is the approval auto-run and headless runs still ask for
      expect(await runApprovals()).toEqual({ exfiltrate: 'always', search: undefined });
    });

    it('needs approval on every call when the server adds or renames one after the install', async () => {
      vi.mocked(mcpService.listRawTools).mockResolvedValue([{ name: 'search' }] as never);
      await installMarketplaceMcpConnector(scope, 'remote-mcp', {
        ...httpManifest,
        tools: [{ name: 'search' }],
      });
      const [row] = await connectorRows();

      // The background (and manual) refresh syncs the listing alone, without the manifest
      vi.mocked(mcpService.listRawTools).mockResolvedValue([
        { name: 'search' },
        { name: 'search_v2' },
        { name: 'exfiltrate' },
      ] as never);
      await syncConnectorToolsById(row.id, {
        connectorModel: new ConnectorModel(db, userId),
        connectorToolModel: new ConnectorToolModel(db, userId),
        serverDB: undefined,
        userId,
      });

      expect(await runApprovals()).toEqual({
        exfiltrate: 'always',
        search: undefined,
        search_v2: 'always',
      });
    });

    it("keeps the manifest's approval for a declared tool the server only lists after the install", async () => {
      // At the install the server lists just one of the tools the manifest declares
      vi.mocked(mcpService.listRawTools).mockResolvedValue([{ name: 'search' }] as never);
      await installMarketplaceMcpConnector(scope, 'remote-mcp', {
        ...httpManifest,
        api: [
          { name: 'search', parameters: {} },
          { humanIntervention: 'required', name: 'send', parameters: {} },
          { humanIntervention: 'always', name: 'delete', parameters: {} },
        ],
      });
      const [row] = await connectorRows();
      expect(row.metadata).toMatchObject({
        marketplaceToolPolicies: { delete: 'always', search: null, send: 'required' },
      });

      // The background refresh lists the rest, without the manifest
      vi.mocked(mcpService.listRawTools).mockResolvedValue([
        { name: 'search' },
        { name: 'send' },
        { name: 'delete' },
      ] as never);
      await syncConnectorToolsById(row.id, {
        connectorModel: new ConnectorModel(db, userId),
        connectorToolModel: new ConnectorToolModel(db, userId),
        serverDB: undefined,
        userId,
      });

      expect(await syncedTools()).toEqual([
        { metadata: { mandatoryApproval: true }, permission: 'needs_approval', toolName: 'delete' },
        { metadata: null, permission: 'auto', toolName: 'search' },
        { metadata: null, permission: 'needs_approval', toolName: 'send' },
      ]);
      expect(await runApprovals()).toEqual({
        delete: 'always',
        search: undefined,
        send: 'required',
      });
    });

    it('covers every tool of a manifest that lists none', async () => {
      vi.mocked(mcpService.listRawTools).mockResolvedValue([{ name: 'search' }] as never);

      await installMarketplaceMcpConnector(scope, 'remote-mcp', httpManifest);

      const [row] = await connectorRows();
      expect(row.metadata).toMatchObject({ marketplaceToolPolicies: {} });
      expect(await runApprovals()).toEqual({ search: 'always' });
    });
  });

  it('reads whether the market hosts the server only when a stdio option makes it decide', async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([{ name: 'search' }] as never);
    const readHostedEndpoint = vi.fn().mockResolvedValue(true);

    // An HTTP-only server: nothing to decide
    expect(
      await installMarketplaceMcpConnector(scope, 'remote-mcp', httpManifest, {
        readHostedEndpoint,
      }),
    ).toEqual({ status: 'installed' });
    // A finished install of a stdio server: nothing to place
    expect(
      await installMarketplaceMcpConnector(
        scope,
        'remote-mcp',
        { ...cloudManifest, haveCloudEndpoint: undefined },
        { readHostedEndpoint },
      ),
    ).toEqual({ status: 'exists' });
    expect(readHostedEndpoint).not.toHaveBeenCalled();

    // A stdio server to place: hosted by the market, so a cloud connector
    expect(
      await installMarketplaceMcpConnector(
        scope,
        'fetch-mcp',
        { ...cloudManifest, haveCloudEndpoint: undefined },
        { readHostedEndpoint },
      ),
    ).toEqual({ status: 'installed' });
    expect(readHostedEndpoint).toHaveBeenCalledTimes(1);
    expect((await connectorRows()).find((row) => row.identifier === 'fetch-mcp')).toMatchObject({
      mcpConnectionType: 'cloud',
    });
  });

  it('removes the connector it created when the server cannot be reached', async () => {
    vi.mocked(mcpService.listRawTools).mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(installMarketplaceMcpConnector(scope, 'remote-mcp', httpManifest)).rejects.toThrow(
      'ECONNREFUSED',
    );

    expect(await connectorRows()).toEqual([]);
    expect(await pluginRows()).toEqual([]);
  });

  it.each([
    ['fails', () => Promise.reject(new Error('connect ECONNREFUSED')), 'connect ECONNREFUSED'],
    ['lists no tools', () => Promise.resolve([]), { blocker: 'no-tools', status: 'blocked' }],
  ])(
    'keeps a connector the web re-added and finished while its listing %s',
    async (_, listing, reported) => {
      vi.mocked(mcpService.listRawTools).mockImplementation(async () => {
        // The web install re-adds the identifier over this install's row
        // (`connector.create` updates it), syncs its tools and marks it
        const [row] = await connectorRows();
        await new ConnectorModel(db, userId).update(row.id, {
          metadata: { marketplaceInstalled: true, version: '0.3.0' },
          status: 'connected',
        });
        await db.insert(userConnectorTools).values({
          crudType: 'read',
          permission: 'auto',
          toolName: 'search',
          userConnectorId: row.id,
          userId,
        });
        return listing() as never;
      });

      // This install still reports its own failure
      expect(
        await installMarketplaceMcpConnector(scope, 'remote-mcp', httpManifest).catch(
          (error: Error) => error.message,
        ),
      ).toEqual(reported);

      const [connector, ...others] = await connectorRows();
      expect(others).toEqual([]);
      expect(connector.metadata).toEqual({ marketplaceInstalled: true, version: '0.3.0' });
      expect((await db.select().from(userConnectorTools)).map((tool) => tool.toolName)).toEqual([
        'search',
      ]);
    },
  );

  it.each([
    [
      'finished',
      { customHeaders: { 'X-Team': 'web' }, marketplaceInstalled: true, version: '0.3.0' },
      'connected',
      { status: 'exists' },
    ],
    [
      'still running',
      { customHeaders: { 'X-Team': 'web' }, version: '0.3.0' },
      'disconnected',
      { blocker: 'in-progress', status: 'blocked' },
    ],
  ] as const)(
    'leaves a connector the web re-added while its listing succeeds to that install (%s)',
    async (_, webMetadata, webStatus, reported) => {
      vi.mocked(mcpService.listRawTools).mockImplementation(async () => {
        // The web install re-adds the identifier over this install's row with
        // the headers its user entered (`connector.create` updates the row),
        // and syncs the tools its own endpoint lists
        const [row] = await connectorRows();
        await new ConnectorModel(db, userId).update(row.id, {
          metadata: webMetadata,
          status: webStatus,
        });
        await db.insert(userConnectorTools).values({
          crudType: 'read',
          description: 'Search (web endpoint)',
          metadata: { mandatoryApproval: true },
          permission: 'needs_approval',
          toolName: 'search',
          userConnectorId: row.id,
          userId,
        });
        // What this install's endpoint listed
        return [
          { description: 'Search (old endpoint)', name: 'search' },
          { name: 'purge' },
        ] as never;
      });

      expect(await installMarketplaceMcpConnector(scope, 'remote-mcp', httpManifest)).toEqual(
        reported,
      );

      const [connector, ...others] = await connectorRows();
      expect(others).toEqual([]);
      // Neither its metadata, status nor tools are replaced by this install's own
      expect(connector.metadata).toEqual(webMetadata);
      expect(connector.status).toBe(webStatus);
      expect(
        (await db.select().from(userConnectorTools)).map(
          ({ description, metadata, permission, toolName }) => ({
            description,
            metadata,
            permission,
            toolName,
          }),
        ),
      ).toEqual([
        {
          description: 'Search (web endpoint)',
          metadata: { mandatoryApproval: true },
          permission: 'needs_approval',
          toolName: 'search',
        },
      ]);
    },
  );

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

  it('installs a hosted server from its tools list when the api list beside it is empty', async () => {
    expect(
      await installMarketplaceMcpConnector(scope, 'fetch-mcp', { ...cloudManifest, api: [] }),
    ).toEqual({ status: 'installed' });
    expect(
      (await db.select().from(userConnectorTools)).map((tool) => tool.toolName).sort(),
    ).toEqual(['fetch', 'purge']);
  });

  it('writes nothing for a server only the user can install', async () => {
    expect(
      await installMarketplaceMcpConnector(scope, 'local-mcp', {
        deploymentOptions: [stdioOption],
      }),
    ).toEqual({ blocker: 'local-only', status: 'blocked' });
    expect(await connectorRows()).toEqual([]);
  });

  it("never has the user's device connect to a private address a market listing gives", async () => {
    // A device gateway would tunnel a private-network listing to the user's device
    gateway.isConfigured = true;
    vi.mocked(listMcpToolsOnDevice).mockResolvedValue([{ name: 'probe' }] as never);

    expect(
      await installMarketplaceMcpConnector(scope, 'lan-mcp', {
        deploymentOptions: [httpOption({ url: 'http://192.168.1.10:8080/mcp' })],
        name: 'LAN MCP',
      }),
    ).toEqual({ blocker: 'private-network', status: 'blocked' });
    expect(listMcpToolsOnDevice).not.toHaveBeenCalled();
    expect(mcpService.listRawTools).not.toHaveBeenCalled();
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

  describe('over duplicate base rows a writer from before the identifier lock left', () => {
    const finishedRow = {
      identifier: 'fetch-mcp',
      mcpConnectionType: 'cloud',
      metadata: { cloudEndPoint: true, marketplaceInstalled: true },
      name: 'Fetch',
      sourceType: 'marketplace',
      status: 'connected',
      userId,
    } as const;
    const seed = async (...rows: (typeof userConnectors.$inferInsert)[]) => {
      // One by one, so the finished install is the oldest row
      for (const row of rows) await db.insert(userConnectors).values(row);
      return connectorRows();
    };

    it('reports a conflict while a custom connector holds the identifier beside a finished install', async () => {
      const before = await seed(finishedRow, {
        ...finishedRow,
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://custom.example.com/mcp',
        metadata: {},
        sourceType: 'custom',
      });

      expect(await installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest)).toEqual({
        blocker: 'conflict',
        status: 'blocked',
      });
      expect(await connectorRows()).toEqual(before);
    });

    it('reports an install in progress beside a finished one as in progress', async () => {
      const before = await seed(finishedRow, {
        ...finishedRow,
        metadata: { cloudEndPoint: true },
        status: 'disconnected',
      });

      expect(await installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest)).toEqual({
        blocker: 'in-progress',
        status: 'blocked',
      });
      expect(await connectorRows()).toEqual(before);
    });

    it('leaves finished installs beside an interrupted one as they are', async () => {
      const before = await seed(
        {
          ...finishedRow,
          metadata: { cloudEndPoint: true },
          status: 'disconnected',
          updatedAt: new Date(Date.now() - MARKETPLACE_INSTALL_LEASE_MS - 60_000),
        },
        finishedRow,
      );

      expect(await installMarketplaceMcpConnector(scope, 'fetch-mcp', cloudManifest)).toEqual({
        status: 'exists',
      });
      expect(await connectorRows()).toEqual(before);
    });
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
