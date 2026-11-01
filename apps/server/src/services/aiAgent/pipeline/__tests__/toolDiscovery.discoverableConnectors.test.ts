import { type LobeToolManifest, ToolNameResolver } from '@lobechat/context-engine';
import { describe, expect, it, vi } from 'vitest';

import { buildToolDiscoveryConfig } from '@/server/modules/AgentRuntime/executorHelpers';
import { scheduleStaleConnectorToolsRefresh } from '@/server/services/connector/refresh';

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

const YINGMI = 'yingmi';

/** A user-created custom MCP: stored as a connector row, not a plugin row. */
const customConnector = {
  credentials: null,
  id: 'conn-yingmi',
  identifier: YINGMI,
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://stargate.yingmi.com/mcp/v2',
  metadata: {},
  name: 'yingmi',
};

const connectorTools = [
  {
    description: 'Batch get fund NAV history',
    inputSchema: { properties: {}, type: 'object' },
    permission: 'auto',
    toolName: 'BatchGetFundNavHistory',
    userConnectorId: customConnector.id,
  },
];

interface RunOptions {
  agentId?: string;
  installed?: boolean;
  /** The agent's own `plugins` config — i.e. what the user pinned. */
  plugins?: string[];
  /** This turn's @-mention picks. */
  selectedToolIds?: string[];
  shareGate?: unknown;
  sourceType?: 'custom' | 'marketplace';
}

const connectorModel = {
  resolveAll: vi.fn(),
  resolveByIdentifiers: vi.fn(),
};

const run = (options: RunOptions = {}) => {
  const connector = {
    ...customConnector,
    agentId: options.agentId ?? null,
    sourceType: options.sourceType ?? 'custom',
    status: 'connected',
  };
  connectorModel.resolveAll.mockReset().mockResolvedValue([connector]);
  connectorModel.resolveByIdentifiers
    .mockReset()
    .mockImplementation(async (ids: string[]) => (ids.includes(YINGMI) ? [connector] : []));

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
      pluginModel: {
        query: vi.fn().mockResolvedValue(options.installed ? [{ identifier: YINGMI }] : []),
      },
      userId: 'user-1',
    } as never,
    {
      agentConfig: { chatConfig: {}, plugins: options.plugins ?? [] },
      appContext: undefined,
      canUseDevice: false,
      model: 'test-model',
      prompt: '470008 呢',
      provider: 'test-provider',
      resolvedAgentId: 'agent-1',
      runFacts: {
        deviceSystemInfo: vi.fn().mockResolvedValue(undefined),
        userPreference: vi.fn().mockResolvedValue(undefined),
      },
      shareGate: options.shareGate,
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

/** Exactly what the model reads in `<available_tools>`. */
const availableToolIds = (
  manifestMap: Record<string, LobeToolManifest>,
  enabledToolIds: string[],
): string[] =>
  (buildToolDiscoveryConfig({ manifestMap } as never, enabledToolIds)?.availableTools ?? []).map(
    (tool) => tool.identifier,
  );

const offeredToolNames = (result: { tools?: { function: { name: string } }[] }) =>
  (result.tools ?? []).map((tool) => tool.function.name);

describe('discoverTools — unpinned custom MCP connectors', () => {
  it.each([
    {},
    { plugins: [YINGMI] },
    { selectedToolIds: [YINGMI] },
    {
      shareGate: {
        agentId: 'agent-1',
        shareConfig: { toolGrants: [{ identifier: YINGMI }] },
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
    },
  ])(
    'rejects a canceled marketplace install even after its OAuth callback connects: %j',
    async (options) => {
      const result = await run({ ...options, sourceType: 'marketplace' });
      expect(result.toolManifestMap[YINGMI]).toBeUndefined();
      expect(result.toolsResult.enabledToolIds).not.toContain(YINGMI);
      const restored = result.toolsEngine!.generateToolsDetailed({
        context: { isExplicitActivation: true },
        model: 'test-model',
        provider: 'test-provider',
        skipDefaultTools: true,
        toolIds: [YINGMI],
      });
      expect(restored.enabledToolIds).not.toContain(YINGMI);
    },
  );

  it.each([
    { label: 'auto', options: {} },
    { label: 'pinned', options: { plugins: [YINGMI] } },
    { label: 'mentioned', options: { selectedToolIds: [YINGMI] } },
    {
      label: 'share granted',
      options: {
        shareGate: {
          agentId: 'agent-1',
          shareConfig: { toolGrants: [{ identifier: YINGMI }] },
          shareId: 'share-1',
          visitorUserId: 'visitor-1',
        },
      },
    },
  ])('preserves an independent agent copy after global uninstall: $label', async ({ options }) => {
    const result = await run({
      ...options,
      agentId: 'agent-1',
      sourceType: 'marketplace',
    });
    expect(result.toolManifestMap[YINGMI]).toBeDefined();
    const activated = result.toolsEngine!.generateToolsDetailed({
      context: { isExplicitActivation: true },
      model: 'test-model',
      provider: 'test-provider',
      skipDefaultTools: true,
      toolIds: [YINGMI],
    });
    expect(activated.enabledToolIds).toContain(YINGMI);
  });

  it('keeps a completed marketplace install discoverable and explicitly activatable', async () => {
    const result = await run({ installed: true, sourceType: 'marketplace' });
    expect(result.toolManifestMap[YINGMI]).toBeDefined();
    const activated = result.toolsEngine!.generateToolsDetailed({
      context: { isExplicitActivation: true },
      model: 'test-model',
      provider: 'test-provider',
      skipDefaultTools: true,
      toolIds: [YINGMI],
    });
    expect(activated.enabledToolIds).toContain(YINGMI);
  });

  it('keeps an unmentioned, unpinned connector discoverable without enabling it', async () => {
    // The follow-up turn after an @-mention: no mention, nothing pinned. The
    // activator used to answer "Not found: yingmi" here.
    const result = await run();

    expect(result.toolManifestMap[YINGMI]).toBeDefined();
    expect(result.toolSourceMap[YINGMI]).toBe('mcp');
    expect(availableToolIds(result.toolManifestMap, result.toolsResult.enabledToolIds)).toContain(
      YINGMI,
    );
    expect(result.toolsResult.enabledToolIds).not.toContain(YINGMI);
    expect(offeredToolNames(result).some((name) => name.startsWith(`${YINGMI}____`))).toBe(false);
  });

  it('lets the next operation restore a previous turn’s activation', async () => {
    const result = await run();

    // The cross-turn restore in `operationPrep` re-checks historical
    // activations through the engine with explicit activation.
    const restored = result.toolsEngine!.generateToolsDetailed({
      context: { isExplicitActivation: true },
      model: 'test-model',
      provider: 'test-provider',
      skipDefaultTools: true,
      toolIds: [YINGMI],
    });

    expect(restored.enabledToolIds).toContain(YINGMI);
    // …and the wire name the model copies from history resolves again.
    const [call] = new ToolNameResolver().resolve(
      [
        {
          function: { arguments: '{}', name: `${YINGMI}____BatchGetFundNavHistory____mcp` },
          id: 'call_1',
          type: 'function',
        },
      ],
      result.toolManifestMap,
    );
    expect(call).toMatchObject({ apiName: 'BatchGetFundNavHistory', identifier: YINGMI });
  });

  it('still enables the connector on the turn that @-mentions it', async () => {
    const result = await run({ selectedToolIds: [YINGMI] });

    expect(result.toolsResult.enabledToolIds).toContain(YINGMI);
    expect(
      offeredToolNames(result).some((name) =>
        name.startsWith(`${YINGMI}____BatchGetFundNavHistory`),
      ),
    ).toBe(true);
  });

  it('schedules the stale-tool refresh for an unpinned connector too', async () => {
    vi.mocked(scheduleStaleConnectorToolsRefresh).mockClear();

    await run();

    // An activatable connector whose upstream tools changed must not keep
    // offering the old list until someone re-syncs it by hand.
    expect(scheduleStaleConnectorToolsRefresh).toHaveBeenCalledTimes(1);
    const [connectors] = vi.mocked(scheduleStaleConnectorToolsRefresh).mock.calls[0];
    expect(connectors.map((c) => c.identifier)).toContain(YINGMI);
  });

  describe('share visitor run', () => {
    const shareGateFor = (toolGrants: { apis?: string[]; identifier: string }[]) => ({
      agentId: 'agent-1',
      shareConfig: { toolGrants },
      shareId: 'share-1',
      visitorUserId: 'visitor-1',
    });

    it('does not resolve or decrypt an ungranted unpinned connector', async () => {
      vi.mocked(scheduleStaleConnectorToolsRefresh).mockClear();

      const result = await run({
        shareGate: shareGateFor([{ identifier: 'lobe-calculator' }, { identifier: 'other-mcp' }]),
      });

      expect(result.toolManifestMap[YINGMI]).toBeUndefined();
      expect(connectorModel.resolveAll).not.toHaveBeenCalled();
      for (const [ids] of connectorModel.resolveByIdentifiers.mock.calls) {
        expect(ids).not.toContain(YINGMI);
      }
      const [connectors] = vi.mocked(scheduleStaleConnectorToolsRefresh).mock.calls[0];
      expect(connectors.map((c) => c.identifier)).not.toContain(YINGMI);
    });

    it('makes a granted unpinned connector activatable without enabling it', async () => {
      const result = await run({ shareGate: shareGateFor([{ identifier: YINGMI }]) });

      // Resolved by identifier only — never the creator's whole connector list.
      expect(connectorModel.resolveAll).not.toHaveBeenCalled();
      expect(connectorModel.resolveByIdentifiers).toHaveBeenCalledWith(
        [YINGMI],
        'agent-1',
        gateKeeper,
      );
      expect(result.toolManifestMap[YINGMI]).toBeDefined();
      expect(result.toolSourceMap[YINGMI]).toBe('mcp');
      expect(result.toolsResult.enabledToolIds).not.toContain(YINGMI);
      expect(availableToolIds(result.toolManifestMap, result.toolsResult.enabledToolIds)).toContain(
        YINGMI,
      );
    });
  });
});
