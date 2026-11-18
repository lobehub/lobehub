// @vitest-environment node
import { ToolResolver } from '@lobechat/context-engine';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import {
  agents,
  userConnectors,
  userInstalledPlugins,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import { buildToolDiscoveryConfig } from '@/server/modules/AgentRuntime/executorHelpers';
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
const WORKSPACE_ID = 'server-market-install-ws';

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
  /** The market's detail of the MCP, or the error reading it fails with. */
  detail: { haveCloudEndpoint?: unknown } | Error = { haveCloudEndpoint: true },
  workspaceId?: string,
) =>
  resolveOrInstallMarketPlugin(
    IDENTIFIER,
    {
      connectorModel: workspaceId ? new ConnectorModel(db, userId, workspaceId) : connectorModel,
      discoverService: {
        getMcpDetail:
          detail instanceof Error
            ? vi.fn().mockRejectedValue(detail)
            : vi.fn().mockResolvedValue(detail),
        getMcpManifest: vi.fn().mockResolvedValue(served),
      },
      installMarketplaceConnector: (identifier, fetched, options) =>
        installMarketplaceMcpConnector(
          { serverDB: db, userId, workspaceId },
          identifier,
          fetched,
          options,
        ),
      pluginModel,
    },
    { agentId: AGENT_ID, source: 'market' },
  );

interface NextRunOptions {
  /** Manual skill-activate mode: the run has no activator. */
  manual?: boolean;
  /** The agent's `plugins`; the install pins the MCP on the agent by default. */
  plugins?: string[];
}

/** The next run of the agent the install pinned the MCP on. */
const nextRun = (options: NextRunOptions = {}) =>
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
      agentConfig: {
        chatConfig: options.manual ? { skillActivateMode: 'manual' } : {},
        plugins: options.plugins ?? [IDENTIFIER],
      },
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

const TOOL_NAME = `${IDENTIFIER}____fetch____mcp`;

const offeredToolNames = (tools: { function: { name: string } }[] | undefined) =>
  (tools ?? []).map((tool) => tool.function.name);

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  await db.delete(workspaces);
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
    'installs a manifest with $label into user_connectors only, and the next run can activate and call it',
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
      // The pin turns the connector on: the run lists it for the activator
      // instead of offering its tools up front.
      expect(run.toolSourceMap[IDENTIFIER]).toBe('mcp');
      expect(run.toolsResult.enabledToolIds).not.toContain(IDENTIFIER);
      expect(offeredToolNames(run.tools)).not.toContain(TOOL_NAME);
      expect(
        (
          buildToolDiscoveryConfig(
            { manifestMap: run.toolManifestMap } as never,
            run.toolsResult.enabledToolIds,
          )?.availableTools ?? []
        ).map((tool) => tool.identifier),
      ).toContain(IDENTIFIER);

      // Activating it offers the model the connector's tool by name
      const activated = new ToolResolver().resolve(
        {
          enabledToolIds: run.toolsResult.enabledToolIds,
          executorMap: run.toolExecutorMap,
          manifestMap: run.toolManifestMap,
          sourceMap: run.toolSourceMap,
          tools: run.tools ?? [],
        },
        {
          activatedTools: [
            {
              activatedAtStep: 1,
              id: IDENTIFIER,
              manifest: run.toolManifestMap[IDENTIFIER],
              source: 'discovery',
            },
          ],
        },
      );
      expect(activated.enabledToolIds).toContain(IDENTIFIER);
      expect(offeredToolNames(activated.tools)).toContain(TOOL_NAME);
      // …and a later operation can restore that activation through the engine
      const restored = run.toolsEngine!.generateToolsDetailed({
        context: { isExplicitActivation: true },
        model: 'test-model',
        provider: 'test-provider',
        skipDefaultTools: true,
        toolIds: [IDENTIFIER],
      });
      expect(restored.enabledToolIds).toContain(IDENTIFIER);
      expect(offeredToolNames(restored.tools)).toContain(TOOL_NAME);

      // A legacy manual preference keeps the activator, so the install is still deferred
      const manualRun = await nextRun({ manual: true });
      expect(manualRun.toolsResult.enabledToolIds).not.toContain(IDENTIFIER);
      expect(offeredToolNames(manualRun.tools)).not.toContain(TOOL_NAME);
      expect(
        (
          buildToolDiscoveryConfig(
            { manifestMap: manualRun.toolManifestMap } as never,
            manualRun.toolsResult.enabledToolIds,
          )?.availableTools ?? []
        ).map((tool) => tool.identifier),
      ).toContain(IDENTIFIER);
    },
  );

  it('keeps the install out of the run of an agent that has not turned it on', async () => {
    await installFromServer();

    const run = await nextRun({ plugins: [] });

    expect(run.toolManifestMap[IDENTIFIER]).toBeUndefined();
    expect(run.toolsResult.enabledToolIds).not.toContain(IDENTIFIER);
    expect(offeredToolNames(run.tools)).not.toContain(TOOL_NAME);
  });

  it('refuses a stdio MCP the market does not host, writing nothing', async () => {
    const { installedNow, resolution } = await installFromServer(manifest, {
      haveCloudEndpoint: false,
    });

    expect(installedNow).toBe(false);
    expect(resolution).toEqual({ blocker: 'local-only', status: 'needs-user-install' });
    expect(await db.select().from(userConnectors)).toEqual([]);
    expect(await db.select().from(userInstalledPlugins)).toEqual([]);
  });

  it('fails, writing nothing, when it cannot read whether the market hosts the MCP', async () => {
    // Not knowing is not "not hosted": a hosted server must not be refused as desktop-only
    await expect(installFromServer(manifest, new Error('market unavailable'))).rejects.toThrow(
      'market unavailable',
    );

    expect(await db.select().from(userConnectors)).toEqual([]);
    expect(await db.select().from(userInstalledPlugins)).toEqual([]);
  });

  it("pins a finished install again even when the market's detail cannot be read", async () => {
    await installFromServer();
    const before = await db.select().from(userConnectors);

    // Whether the market hosts it only matters for an install still to place
    const { installedNow, resolution } = await installFromServer(
      manifest,
      new Error('market unavailable'),
    );

    expect(installedNow).toBe(false);
    expect(resolution).toEqual({ source: 'connector', status: 'loadable' });
    expect(await db.select().from(userConnectors)).toEqual(before);
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

  it.each([
    { label: 'disconnected', resolved: { status: 'not-connected' }, status: 'disconnected' },
    {
      label: 'connected',
      resolved: { source: 'connector', status: 'loadable' },
      status: 'connected',
    },
  ] as const)(
    "reports the agent's own $label connector, which its runs pick, and installs nothing",
    async ({ resolved, status }) => {
      await db.insert(agents).values({ id: AGENT_ID, userId });
      await db.insert(userConnectors).values({
        agentId: AGENT_ID,
        identifier: IDENTIFIER,
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.example.com/mcp',
        name: 'Agent copy',
        sourceType: 'custom',
        status,
        userId,
      });

      const { installedNow, resolution } = await installFromServer();

      expect(installedNow).toBe(false);
      expect(resolution).toEqual(resolved);
      // No base connector its runs would never reach
      expect(await db.select().from(userConnectors)).toEqual([
        expect.objectContaining({ agentId: AGENT_ID, name: 'Agent copy' }),
      ]);
    },
  );

  it.each([
    {
      label: 'private',
      resolved: { status: 'not-connected' },
      row: { status: 'disconnected', visibility: 'private', workspaceId: WORKSPACE_ID },
    },
    {
      label: 'personal',
      resolved: { source: 'connector', status: 'loadable' },
      row: { status: 'connected', workspaceId: null },
    },
  ] as const)(
    "reports the owner's $label connector its private agent's own conversation picks, and adds no shared one",
    async ({ resolved, row }) => {
      await db
        .insert(workspaces)
        .values({ id: WORKSPACE_ID, name: 'WS', primaryOwnerId: userId, slug: WORKSPACE_ID });
      await db
        .insert(workspaceMembers)
        .values({ role: 'owner', userId, workspaceId: WORKSPACE_ID });
      await db
        .insert(agents)
        .values({ id: AGENT_ID, userId, visibility: 'private', workspaceId: WORKSPACE_ID });
      await db.insert(userConnectors).values({
        identifier: IDENTIFIER,
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.example.com/mcp',
        name: 'Owner copy',
        sourceType: 'custom',
        userId,
        ...row,
      });

      const { installedNow, resolution } = await installFromServer(
        manifest,
        { haveCloudEndpoint: true },
        WORKSPACE_ID,
      );

      expect(installedNow).toBe(false);
      expect(resolution).toEqual(resolved);
      // No shared connector that the agent's own runs rank below the owner's row
      expect(await db.select().from(userConnectors)).toEqual([
        expect.objectContaining({ name: 'Owner copy' }),
      ]);
    },
  );

  it('installs a shared connector for a private agent whose owner has none of it', async () => {
    await db
      .insert(workspaces)
      .values({ id: WORKSPACE_ID, name: 'WS', primaryOwnerId: userId, slug: WORKSPACE_ID });
    await db.insert(workspaceMembers).values({ role: 'owner', userId, workspaceId: WORKSPACE_ID });
    await db
      .insert(agents)
      .values({ id: AGENT_ID, userId, visibility: 'private', workspaceId: WORKSPACE_ID });

    const { installedNow, resolution } = await installFromServer(
      manifest,
      { haveCloudEndpoint: true },
      WORKSPACE_ID,
    );

    expect(installedNow).toBe(true);
    expect(resolution).toEqual({ source: 'connector', status: 'loadable' });
    expect(await db.select().from(userConnectors)).toEqual([
      expect.objectContaining({
        identifier: IDENTIFIER,
        visibility: 'public',
        workspaceId: WORKSPACE_ID,
      }),
    ]);
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
