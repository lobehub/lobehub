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
  /** An installed marker with no APIs; the connector owns the real tools. */
  installedMarker?: boolean;
  /** The agent's own `plugins` config — i.e. what the user pinned. */
  plugins?: string[];
  /** This turn's @-mention picks. */
  selectedToolIds?: string[];
  shareGate?: unknown;
}

const run = (options: RunOptions = {}) => {
  const candidates = new Set([...(options.plugins ?? []), ...(options.selectedToolIds ?? [])]);

  return discoverTools(
    {
      agentDocumentsService: { hasDocuments: vi.fn().mockResolvedValue(false) },
      composioService: { getComposioManifests: vi.fn().mockResolvedValue([]) },
      connectorModel: {
        resolveAll: vi.fn().mockResolvedValue([customConnector]),
        resolveByIdentifiers: vi.fn(async (ids: string[]) =>
          ids.includes(YINGMI) && candidates.has(YINGMI) ? [customConnector] : [],
        ),
      },
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
        query: vi.fn().mockResolvedValue(
          options.installedMarker
            ? [
                {
                  identifier: YINGMI,
                  manifest: {
                    api: [],
                    identifier: YINGMI,
                    meta: { title: 'Installed MCP' },
                    type: 'mcp',
                  },
                  runtimeType: 'mcp',
                },
              ]
            : [],
        ),
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

  it('does not decrypt unpinned connectors for a share visitor run', async () => {
    const result = await run({
      shareGate: {
        agentId: 'agent-1',
        shareConfig: { toolGrants: [] },
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
    });

    expect(result.toolManifestMap[YINGMI]).toBeUndefined();
  });
});

describe('discoverTools — installed marker backed by an unpinned connector', () => {
  it('activates the connector APIs instead of the empty installed manifest', async () => {
    const result = await run({ installedMarker: true });

    expect(result.toolsResult.enabledToolIds).not.toContain(YINGMI);
    expect(availableToolIds(result.toolManifestMap, result.toolsResult.enabledToolIds)).toContain(
      YINGMI,
    );
    expect(result.toolManifestMap[YINGMI].api.map((api) => api.name)).toEqual([
      'BatchGetFundNavHistory',
    ]);
    expect(result.toolSourceMap[YINGMI]).toBe('mcp');
    expect(result.toolManifestMap[YINGMI]).toMatchObject({
      mcpParams: { type: 'http', url: customConnector.mcpServerUrl },
    });

    const { activatorRuntime } =
      await import('@/server/services/toolExecution/serverRuntimes/activator');
    const runtime = await activatorRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: result.toolManifestMap,
      userId: 'user-1',
    });
    const activation = await runtime.activateTools({ identifiers: [YINGMI] });
    expect(activation.success).toBe(true);
    expect(activation.state.activatedTools).toEqual([
      { apiCount: 1, identifier: YINGMI, name: customConnector.name },
    ]);
    expect(activation.content).toContain(`${YINGMI}.BatchGetFundNavHistory`);

    const restored = result.toolsEngine!.generateToolsDetailed({
      context: { isExplicitActivation: true },
      model: 'test-model',
      provider: 'test-provider',
      skipDefaultTools: true,
      toolIds: [YINGMI],
    });
    expect(restored.tools?.map((tool) => tool.function.name)).toContain(
      `${YINGMI}____BatchGetFundNavHistory____mcp`,
    );
  });
});
