import { describe, expect, it, vi } from 'vitest';

import { refreshExpiredLinkTokens } from '@/server/services/connector/tokens';

import { discoverTools } from '../toolDiscovery';

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: class {
    findByIdAndProvider = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: class {
    findById = vi.fn().mockResolvedValue(undefined);
  },
}));
// The background stale-tool refresh reaches for the request-scoped `after()`,
// which does not exist in a bare unit-test runtime.
vi.mock('@/server/services/connector/refresh', () => ({
  buildLastSyncedAtMap: vi.fn().mockReturnValue(new Map()),
  scheduleStaleConnectorToolsRefresh: vi.fn(),
}));
// The gatekeeper encrypts rotated credentials; without one discovery skips
// the refresh, so stand one in for the bare test runtime.
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@/server/services/connector/tokens', () => ({
  refreshExpiredConnectorTokens: vi.fn(async (connectors: any[]) => connectors),
  refreshExpiredLinkTokens: vi.fn(async (_connector: unknown, links: any[]) =>
    links.map((link) => ({ ...link, credentials: { accessToken: 'fresh', type: 'oauth2' } })),
  ),
}));
// The OAuth token lives on the connector's account, read through the link
// storage; stand that in so the bare runtime needs no database.
vi.mock('@/server/services/connector/links', async (original) => ({
  ...(await original<object>()),
  getConnectorLinkModel: vi.fn().mockReturnValue({}),
  loadConnectorLinksMap: vi.fn(
    async (connectors: { id: string }[]) =>
      new Map(
        connectors.map((connector) => [
          connector.id,
          [
            {
              credentials: { accessToken: 'expired', type: 'oauth2' },
              id: 'lnk_xmind',
              name: 'Default',
              status: 'connected',
              userConnectorId: connector.id,
            },
          ],
        ]),
      ),
  ),
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { isConfigured: false, queryDeviceList: vi.fn().mockResolvedValue([]) },
}));

const XMIND = 'xmind-mcp';

const oauthConnector = {
  credentials: null,
  id: 'conn-xmind',
  identifier: XMIND,
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://app.xmind.com/api/mcp',
  metadata: {},
  name: 'XMind',
  oidcConfig: { clientId: 'client', scheme: 'dcr' },
};

const connectorTools = [
  {
    description: 'Who am I',
    inputSchema: { properties: {}, type: 'object' },
    permission: 'auto',
    toolName: 'xmind_whoami',
    userConnectorId: oauthConnector.id,
  },
];

interface RunOptions {
  /** The agent's `auto` entries: on without a legacy pin. */
  autoSkillIds?: string[];
  /** The agent's legacy pinned entries, which also read as on. */
  plugins?: string[];
  /** This turn's @-mention picks. */
  selectedToolIds?: string[];
}

const connectorModel = {
  resolveAll: vi.fn(),
  resolveByIdentifiers: vi.fn(),
};

const run = (options: RunOptions = {}) => {
  connectorModel.resolveAll.mockReset().mockResolvedValue([oauthConnector]);
  connectorModel.resolveByIdentifiers
    .mockReset()
    .mockImplementation(async (ids: string[]) => (ids.includes(XMIND) ? [oauthConnector] : []));

  return discoverTools(
    {
      agentDocumentsService: { hasDocuments: vi.fn().mockResolvedValue(false) },
      composioService: { getComposioManifests: vi.fn().mockResolvedValue([]) },
      connectorModel,
      connectorToolModel: {
        queryAllByConnectorIds: vi.fn().mockResolvedValue(connectorTools),
        queryByConnector: vi.fn().mockResolvedValue([]),
      },
      db: {} as never,
      getMarketService: vi.fn().mockResolvedValue({
        getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
      }),
      messageModel: { update: vi.fn() },
      pluginModel: { query: vi.fn().mockResolvedValue([]) },
      userId: 'creator-1',
    } as never,
    {
      agentConfig: { chatConfig: {}, plugins: options.plugins ?? [] },
      appContext: undefined,
      autoSkillIds: options.autoSkillIds ?? [],
      canUseDevice: false,
      model: 'test-model',
      prompt: 'make a mind map',
      provider: 'test-provider',
      resolvedAgentId: 'agent-1',
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
      selectedToolIds: options.selectedToolIds,
      throwIfExecutionAborted: vi.fn(),
    } as never,
  );
};

const manifestToken = (manifest: unknown) =>
  (manifest as { mcpParams?: { auth?: { accessToken?: string } } })?.mcpParams?.auth?.accessToken;

// A single-account manifest carries that account's token for the whole run, so
// an expired-but-refreshable token used to 401 on the first call after expiry.
describe('discoverTools — connector OAuth token refresh', () => {
  it.each([
    // Both entries turn the connector on, so it is read with the discoverable ones.
    { label: 'the agent pinned', options: { plugins: [XMIND] } },
    { label: 'the agent turned on', options: { autoSkillIds: [XMIND] } },
    // The turn brings it in, so it is resolved straight into the invocation set.
    { label: 'the turn @-mentions', options: { selectedToolIds: [XMIND] } },
  ])(
    'builds the manifest of a connector $label from refreshed credentials',
    async ({ options }) => {
      vi.mocked(refreshExpiredLinkTokens).mockClear();

      const result = await run(options);

      expect(refreshExpiredLinkTokens).toHaveBeenCalled();
      expect(manifestToken(result.toolManifestMap[XMIND])).toBe('fresh');
    },
  );

  it('neither resolves nor refreshes a connector the agent never turned on', async () => {
    vi.mocked(refreshExpiredLinkTokens).mockClear();

    const result = await run();

    expect(result.toolManifestMap[XMIND]).toBeUndefined();
    expect(connectorModel.resolveAll).not.toHaveBeenCalled();
    expect(connectorModel.resolveByIdentifiers).not.toHaveBeenCalled();
    expect(refreshExpiredLinkTokens).not.toHaveBeenCalled();
  });
});
