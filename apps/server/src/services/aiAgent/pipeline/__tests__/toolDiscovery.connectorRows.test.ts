import { describe, expect, it, vi } from 'vitest';

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
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { isConfigured: false, queryDeviceList: vi.fn().mockResolvedValue([]) },
}));
// Pin the gatekeeper so the share assertions do not depend on the developer's
// encryption key: without it discovery falls back to resolving undecrypted.
const gateKeeper = vi.hoisted(() => ({ decrypt: () => {} }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue(gateKeeper) },
}));

/**
 * One connector identifier, two rows a private agent's own topic may use: the
 * workspace's shared GitHub and the owner's private one. They connect different
 * accounts and were synced at different times, so each is its own tool set.
 */
const shared = {
  credentials: null,
  id: 'conn-shared',
  identifier: 'github',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example/shared',
  metadata: {},
  name: 'GitHub',
  toolIdentifier: 'github',
  visibility: 'public',
};
const mine = {
  ...shared,
  id: 'conn-mine',
  mcpServerUrl: 'https://mcp.example/mine',
  toolIdentifier: 'github-abcd1234',
  visibility: 'private',
};
const tool = (userConnectorId: string, toolName: string) => ({
  description: toolName,
  inputSchema: { properties: {}, type: 'object' },
  permission: 'auto',
  toolName,
  userConnectorId,
});

const run = (plugins: unknown[]) =>
  discoverTools(
    {
      agentDocumentsService: { hasDocuments: vi.fn().mockResolvedValue(false) },
      composioService: { getComposioManifests: vi.fn().mockResolvedValue([]) },
      connectorModel: {
        resolveAll: vi.fn().mockResolvedValue([]),
        resolveByIdentifiers: vi.fn().mockResolvedValue([]),
        resolveToolSets: vi.fn(async (_target: unknown, ids?: string[]) =>
          !ids || ids.includes('github') ? [mine, shared] : [],
        ),
      },
      connectorToolModel: {
        queryAllByConnectorIds: vi
          .fn()
          .mockResolvedValue([
            tool('conn-shared', 'list_issues'),
            tool('conn-mine', 'list_issues'),
            tool('conn-mine', 'create_issue'),
          ]),
        queryByConnector: vi.fn().mockResolvedValue([]),
      },
      db: {} as never,
      getMarketService: vi.fn().mockResolvedValue({
        getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
      }),
      messageModel: { update: vi.fn() },
      pluginModel: { query: vi.fn().mockResolvedValue([]) },
      userId: 'owner',
    } as never,
    {
      agentConfig: { chatConfig: {}, plugins },
      appContext: undefined,
      canUseDevice: false,
      model: 'test-model',
      prompt: 'open an issue',
      provider: 'test-provider',
      resolvedAgentId: 'agent-private',
      runFacts: {
        deviceSystemInfo: vi.fn().mockResolvedValue(undefined),
        userPreference: vi.fn().mockResolvedValue(undefined),
      },
      topicId: 'tpc-own',
    } as never,
    {
      disabledPluginIds: plugins.flatMap((entry) =>
        typeof entry === 'object' && (entry as { mode?: string }).mode === 'disabled'
          ? [(entry as { identifier: string }).identifier]
          : [],
      ),
      globalMemoryEnabled: false,
      hasMentionedAgents: false,
      isFixedDeviceTarget: false,
      loadHistoryMessages: vi.fn().mockResolvedValue([]),
      throwIfExecutionAborted: vi.fn(),
    } as never,
  );

const toolNames = (result: { tools?: { function: { name: string } }[] }) =>
  (result.tools ?? [])
    .map((item) => item.function.name)
    .filter((name) => name.startsWith('github'))
    .sort();

describe('discoverTools — same-identifier connector rows', () => {
  it('offers each row its own tool set, each executing on its own row', async () => {
    const result = await run(['github']);

    expect(toolNames(result.toolsResult)).toEqual([
      'github-abcd1234____create_issue____mcp',
      'github-abcd1234____list_issues____mcp',
      'github____list_issues____mcp',
    ]);
    const own = result.toolManifestMap['github-abcd1234'] as any;
    expect(own.connector).toEqual({ id: 'conn-mine', identifier: 'github' });
    expect(own.mcpParams).toMatchObject({ name: 'github', url: 'https://mcp.example/mine' });
    expect((result.toolManifestMap.github as any).mcpParams.url).toBe('https://mcp.example/shared');
  });

  it("drops every row's tool set when the agent disables the connector", async () => {
    const result = await run([{ identifier: 'github', mode: 'disabled' }]);

    expect(toolNames(result.toolsResult)).toEqual([]);
    expect(result.toolManifestMap['github-abcd1234']).toBeUndefined();
    expect(result.toolManifestMap.github).toBeUndefined();
  });
});
