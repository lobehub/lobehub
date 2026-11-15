// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import { agents, userConnectors, userInstalledPlugins, users } from '@/database/schemas';
import { discoverTools } from '@/server/services/aiAgent/pipeline/toolDiscovery';
import {
  installMarketplaceMcpConnector,
  type MarketMcpManifest,
} from '@/server/services/connector/marketplaceInstall';

import { searchMarketTools } from '../marketToolSearch';
import { resolveOrInstallMarketPlugin } from '../pluginResolution';

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));
// The background stale-tool refresh reaches for the request-scoped `after()`,
// which does not exist in a bare unit-test runtime.
vi.mock('@/server/services/connector/refresh', () => ({
  buildLastSyncedAtMap: vi.fn().mockReturnValue(new Map()),
  scheduleStaleConnectorToolsRefresh: vi.fn(),
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { isConfigured: false, queryDeviceList: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue(undefined) },
}));

const db = await getTestDB();
const userId = 'server-market-install-user';
const AGENT_ID = 'agent-1';
const IDENTIFIER = 'fetch-mcp';

/**
 * A stdio MCP, the way `market.getMcpManifest` serves it: whether the market
 * hosts it is on its detail (`haveCloudEndpoint`), not in the manifest.
 */
const manifest: MarketMcpManifest = {
  deploymentOptions: [{ connection: { args: ['-y', IDENTIFIER], command: 'npx', type: 'stdio' } }],
  name: 'Fetch',
  tools: [{ description: 'Fetch a URL', inputSchema: { type: 'object' }, name: 'fetch' }],
  version: '1.2.0',
};

const pluginModel = new PluginModel(db, userId);
const connectorModel = new ConnectorModel(db, userId);

const installFromServer = (
  served: MarketMcpManifest = manifest,
  detail: { haveCloudEndpoint?: unknown } = { haveCloudEndpoint: true },
) =>
  resolveOrInstallMarketPlugin(
    IDENTIFIER,
    {
      connectorModel,
      discoverService: {
        getMcpDetail: vi.fn().mockResolvedValue(detail),
        getMcpManifest: vi.fn().mockResolvedValue(served),
      },
      installMarketplaceConnector: (identifier, fetched) =>
        installMarketplaceMcpConnector({ serverDB: db, userId }, identifier, fetched),
      pluginModel,
    },
    { agentId: AGENT_ID, source: 'market' },
  );

/** The next run of the agent the install pinned the MCP on. */
const nextRun = () =>
  discoverTools(
    {
      agentDocumentsService: { hasDocuments: vi.fn().mockResolvedValue(false) },
      composioService: { getComposioManifests: vi.fn().mockResolvedValue([]) },
      connectorModel,
      connectorToolModel: new ConnectorToolModel(db, userId),
      db,
      getMarketService: vi.fn().mockResolvedValue({
        getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
      }),
      messageModel: { update: vi.fn() },
      pluginModel,
      userId,
    } as never,
    {
      agentConfig: { chatConfig: {}, plugins: [IDENTIFIER] },
      appContext: undefined,
      canUseDevice: false,
      model: 'test-model',
      prompt: 'fetch https://example.com',
      provider: 'test-provider',
      resolvedAgentId: AGENT_ID,
      runFacts: {
        deviceSystemInfo: vi.fn().mockResolvedValue(undefined),
        userPreference: vi.fn().mockResolvedValue(undefined),
      },
    } as never,
    {
      disabledPluginIds: [],
      globalMemoryEnabled: false,
      hasMentionedAgents: false,
      isFixedDeviceTarget: false,
      loadHistoryMessages: vi.fn().mockResolvedValue([]),
      throwIfExecutionAborted: vi.fn(),
    } as never,
  );

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  await db.delete(users);
});

describe('resolveOrInstallMarketPlugin — server-side marketplace install', () => {
  it.each([
    { label: 'MCP tools', served: manifest },
    // The shape the server used to store as a manifest-only plugin row
    {
      label: 'an API list',
      served: {
        ...manifest,
        api: [{ description: 'Fetch a URL', name: 'fetch', parameters: { type: 'object' } }],
      },
    },
  ])(
    'installs a manifest with $label into user_connectors only, and the next run can call it',
    async ({ served }) => {
      const { installedNow, resolution } = await installFromServer(served);

      expect(installedNow).toBe(true);
      expect(resolution).toEqual({ source: 'connector', status: 'loadable' });
      expect(await db.select().from(userInstalledPlugins)).toEqual([]);
      expect(await db.select().from(userConnectors)).toEqual([
        expect.objectContaining({
          identifier: IDENTIFIER,
          metadata: expect.objectContaining({ marketplaceInstalled: true }),
          sourceType: 'marketplace',
          status: 'connected',
        }),
      ]);

      const run = await nextRun();
      expect(run.toolManifestMap[IDENTIFIER]).toMatchObject({
        api: [expect.objectContaining({ name: 'fetch' })],
        mcpParams: expect.objectContaining({ type: 'cloud' }),
      });
      expect(run.toolsResult.enabledToolIds).toContain(IDENTIFIER);
      // The model is offered the connector's tool by name
      expect((run.tools ?? []).map((tool) => tool.function.name)).toContain(
        `${IDENTIFIER}____fetch____mcp`,
      );
    },
  );

  it('refuses a stdio MCP the market does not host, writing nothing', async () => {
    const { installedNow, resolution } = await installFromServer(manifest, {
      haveCloudEndpoint: false,
    });

    expect(installedNow).toBe(false);
    expect(resolution).toEqual({ blocker: 'local-only', status: 'needs-user-install' });
    expect(await db.select().from(userConnectors)).toEqual([]);
    expect(await db.select().from(userInstalledPlugins)).toEqual([]);
  });

  it('pins a finished install again without writing anything', async () => {
    await installFromServer();
    const before = await db.select().from(userConnectors);

    const { installedNow, resolution } = await installFromServer();

    expect(installedNow).toBe(false);
    expect(resolution).toEqual({ source: 'connector', status: 'loadable' });
    expect(await db.select().from(userConnectors)).toEqual(before);
    expect(await db.select().from(userInstalledPlugins)).toEqual([]);
  });

  it("reports the agent's own disconnected connector, which its runs pick over the install", async () => {
    await db.insert(agents).values({ id: AGENT_ID, userId });
    await db.insert(userConnectors).values({
      agentId: AGENT_ID,
      identifier: IDENTIFIER,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mcp.example.com/mcp',
      name: 'Agent copy',
      sourceType: 'custom',
      status: 'disconnected',
      userId,
    });

    const { installedNow, resolution } = await installFromServer();

    expect(installedNow).toBe(true);
    expect(resolution).toEqual({ status: 'not-connected' });
  });

  it('reports the install as installed in the next marketplace search', async () => {
    const search = () =>
      searchMarketTools(
        {
          connectorModel,
          discoverService: {
            getMcpList: vi.fn().mockResolvedValue({
              items: [{ identifier: IDENTIFIER, name: 'Fetch' }],
              totalCount: 1,
            }),
          },
          pluginModel,
        },
        { query: 'fetch' },
      );
    expect((await search()).state.tools).toEqual([
      expect.objectContaining({ identifier: IDENTIFIER, installed: false }),
    ]);

    await installFromServer();

    const result = await search();
    expect(result.state.tools).toEqual([
      expect.objectContaining({ identifier: IDENTIFIER, installed: true }),
    ]);
    expect(result.content).toContain(`(${IDENTIFIER}) [installed]`);
  });

  it('keeps reading a plugin row an earlier server install wrote', async () => {
    await db.insert(userInstalledPlugins).values({
      identifier: IDENTIFIER,
      manifest: { api: [{ name: 'fetch' }], identifier: IDENTIFIER } as never,
      type: 'plugin',
      userId,
    });

    const { installedNow, resolution } = await installFromServer();

    expect(installedNow).toBe(false);
    expect(resolution).toEqual({ source: 'installed', status: 'loadable' });
    expect(await db.select().from(userConnectors)).toEqual([]);
  });
});
