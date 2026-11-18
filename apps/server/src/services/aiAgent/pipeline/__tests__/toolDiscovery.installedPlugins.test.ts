import { type LobeToolManifest, ToolResolver } from '@lobechat/context-engine';
import { describe, expect, it, vi } from 'vitest';

import { buildToolDiscoveryConfig } from '@/server/modules/AgentRuntime/executorHelpers';

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
// `isConfigured` decides `gatewayConfigured`, i.e. whether a run routes tool
// calls through a device gateway — the tests flip it to cover both modes.
const { deviceGatewayState } = vi.hoisted(() => ({ deviceGatewayState: { isConfigured: false } }));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    get isConfigured() {
      return deviceGatewayState.isConfigured;
    },
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

const FEISHU = 'tituwork-feishu-mcp';

/**
 * A user-level installed MCP plugin row, shaped like `PluginModel.query()`:
 * the manifest carries the `api` list the activator's manifest map needs.
 */
const installedPlugin = (identifier: string, transport: 'http' | 'stdio' = 'http') => ({
  customParams: { mcp: { type: transport } },
  identifier,
  manifest: {
    api: [
      {
        description: 'Send a message to a Feishu chat',
        name: 'sendMessage',
        parameters: { properties: {}, type: 'object' },
      },
    ],
    identifier,
    meta: { description: 'Feishu MCP', title: 'Feishu MCP' },
    type: 'mcp',
  },
  runtimeType: 'mcp',
});

interface RunOptions {
  /** The agent's `auto` entries: what turns a plugin on without a legacy pin. */
  autoSkillIds?: string[];
  chatConfig?: Record<string, unknown>;
  disabledPluginIds?: string[];
  /** A device gateway is configured for the deployment. */
  gatewayConfigured?: boolean;
  /** The agent's legacy pinned entries, which also read as on. */
  plugins?: string[];
  /** This turn's @-mention picks. */
  selectedToolIds?: string[];
  /** Transport the installed plugin row reports. */
  transport?: 'http' | 'stdio';
}

const run = (options: RunOptions = {}) => {
  deviceGatewayState.isConfigured = options.gatewayConfigured ?? false;

  return discoverTools(
    {
      agentDocumentsService: { hasDocuments: vi.fn().mockResolvedValue(false) },
      composioService: { getComposioManifests: vi.fn().mockResolvedValue([]) },
      connectorModel: { resolveByIdentifiers: vi.fn().mockResolvedValue([]) },
      connectorToolModel: {
        queryAllByConnectorIds: vi.fn().mockResolvedValue([]),
        queryByConnector: vi.fn().mockResolvedValue([]),
      },
      db: {} as never,
      getMarketService: vi.fn().mockResolvedValue({
        getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
      }),
      messageModel: { update: vi.fn() },
      pluginModel: {
        query: vi.fn().mockResolvedValue([installedPlugin(FEISHU, options.transport ?? 'http')]),
      },
      userId: 'user-1',
    } as never,
    {
      agentConfig: { chatConfig: options.chatConfig ?? {}, plugins: options.plugins ?? [] },
      appContext: undefined,
      autoSkillIds: options.autoSkillIds ?? [],
      canUseDevice: false,
      model: 'test-model',
      prompt: 'send a message to the team chat',
      provider: 'test-provider',
      resolvedAgentId: 'agent-1',
      runFacts: {
        deviceSystemInfo: vi.fn().mockResolvedValue(undefined),
        userPreference: vi.fn().mockResolvedValue(undefined),
      },
      shareGate: undefined,
    } as never,
    {
      disabledPluginIds: options.disabledPluginIds ?? [],
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

/** The agent turned the plugin on: an `auto` entry in its plugins. */
const ON = { autoSkillIds: [FEISHU] };
const MANUAL = { chatConfig: { skillActivateMode: 'manual' } };

describe('discoverTools — installed plugins are opt-in per agent', () => {
  it('only offers a configurable builtin to discovery when this agent opted in', async () => {
    const id = 'lobe-skill-store';
    expect((await run()).toolManifestMap[id]).toBeUndefined();
    const on = await run({ autoSkillIds: [id] });
    expect(availableToolIds(on.toolManifestMap, on.toolsResult.enabledToolIds)).toContain(id);
    expect(on.toolsResult.enabledToolIds).not.toContain(id);
  });

  it('keeps an installed plugin the agent never turned on out of the run', async () => {
    const result = await run();

    expect(result.toolManifestMap[FEISHU]).toBeUndefined();
    expect(result.toolsResult.enabledToolIds).not.toContain(FEISHU);
    expect(
      availableToolIds(result.toolManifestMap, result.toolsResult.enabledToolIds),
    ).not.toContain(FEISHU);
    expect(offeredToolNames(result).some((name) => name.startsWith(`${FEISHU}____`))).toBe(false);
  });

  it.each([
    { label: 'turned on', options: ON },
    { label: 'turned on with an old manual preference', options: { ...ON, ...MANUAL } },
    { label: 'pinned with an old manual preference', options: { ...MANUAL, plugins: [FEISHU] } },
    { label: 'pinned', options: { plugins: [FEISHU] } },
  ])(
    'offers an installed plugin the agent $label to the activator without enabling it',
    async ({ options }) => {
      const result = await run(options);

      // Discoverable: the activator resolves against `toolManifestMap`, so a
      // missing entry here is exactly the "Not found: tituwork-feishu-mcp" the
      // model used to get.
      expect(result.toolManifestMap[FEISHU]).toBeDefined();
      expect(result.toolSourceMap[FEISHU]).toBe('mcp');
      expect(availableToolIds(result.toolManifestMap, result.toolsResult.enabledToolIds)).toContain(
        FEISHU,
      );

      // …but NOT enabled: a plugin that is on is found on demand, so the APIs
      // are not offered up-front and the model has to activate.
      expect(result.toolsResult.enabledToolIds).not.toContain(FEISHU);
      expect(offeredToolNames(result).some((name) => name.startsWith(`${FEISHU}____`))).toBe(false);
    },
  );

  it.each([
    // The turn brings the plugin in itself, whatever the agent's switch says.
    { label: 'the turn @-mentions', options: { selectedToolIds: [FEISHU] } },
  ])('enables a plugin $label directly', async ({ options }) => {
    const result = await run(options);

    expect(result.toolsResult.enabledToolIds).toContain(FEISHU);
    // `<identifier>____<api>____mcp` — the MCP plugin type rides on the name.
    expect(
      offeredToolNames(result).some((name) => name.startsWith(`${FEISHU}____sendMessage`)),
    ).toBe(true);
    // Enabled tools are not listed as available-to-activate.
    expect(
      availableToolIds(result.toolManifestMap, result.toolsResult.enabledToolIds),
    ).not.toContain(FEISHU);
  });

  it('keeps an installed plugin that is off out of a manual-mode run', async () => {
    const result = await run(MANUAL);

    expect(result.toolManifestMap[FEISHU]).toBeUndefined();
    expect(result.toolsResult.enabledToolIds).not.toContain(FEISHU);
  });

  it.each([
    { label: 'with no other entry', options: {} },
    // A disabled id wins over every way the plugin could otherwise be on.
    { label: 'that is also on', options: ON },
    { label: 'that is also pinned in manual mode', options: { ...MANUAL, plugins: [FEISHU] } },
    { label: 'that the turn @-mentions', options: { selectedToolIds: [FEISHU] } },
  ])('keeps a disabled plugin $label out of both paths', async ({ options }) => {
    const result = await run({ ...options, disabledPluginIds: [FEISHU] });

    expect(result.toolManifestMap[FEISHU]).toBeUndefined();
    expect(result.toolsResult.enabledToolIds).not.toContain(FEISHU);
    expect(
      availableToolIds(result.toolManifestMap, result.toolsResult.enabledToolIds),
    ).not.toContain(FEISHU);
    expect(offeredToolNames(result).some((name) => name.startsWith(`${FEISHU}____`))).toBe(false);
  });
});

/**
 * Replay the activator's effect on the operation's tool set: `ToolResolver`
 * copies the executor map into the operation snapshot and `applyActivation`
 * never revisits it, so discovery is the only place the dispatch target can be
 * decided for a tool that only becomes callable mid-run.
 */
const activateAfterDiscovery = (
  result: Awaited<ReturnType<typeof run>>,
  identifier: string,
): ReturnType<ToolResolver['resolve']> =>
  new ToolResolver().resolve(
    {
      enabledToolIds: result.toolsResult.enabledToolIds,
      executorMap: result.toolExecutorMap,
      manifestMap: result.toolManifestMap,
      sourceMap: result.toolSourceMap,
      tools: result.tools ?? [],
    },
    { activatedTools: [] },
    [
      {
        activatedAtStep: 1,
        id: identifier,
        manifest: result.toolManifestMap[identifier],
        source: 'discovery',
      },
    ],
  );

describe('discoverTools — executor routing for a discoverable MCP plugin', () => {
  it('keeps a discoverable stdio plugin client-executed across activation', async () => {
    const result = await run({ ...ON, transport: 'stdio' });

    // A stdio MCP runs as a local process on the user's machine, so it must
    // never be dispatched to the self-hosted server.
    expect(result.toolExecutorMap[FEISHU]).toBe('client');

    const resolved = activateAfterDiscovery(result, FEISHU);
    expect(resolved.enabledToolIds).toContain(FEISHU);
    expect(resolved.executorMap?.[FEISHU]).toBe('client');
  });

  it('leaves a discoverable http plugin on the server execution path', async () => {
    const result = await run({ ...ON, transport: 'http' });

    expect(result.toolManifestMap[FEISHU]).toBeDefined();
    expect(result.toolExecutorMap[FEISHU]).toBeUndefined();
    expect(activateAfterDiscovery(result, FEISHU).executorMap?.[FEISHU]).toBeUndefined();
  });

  it('lets a configured device gateway own the route', async () => {
    const result = await run({ ...ON, gatewayConfigured: true, transport: 'stdio' });

    // With a gateway every caller converges on the device-gateway path, so no
    // client executor is set — the remote-device proxy resolves the route.
    expect(result.toolManifestMap[FEISHU]).toBeDefined();
    expect(result.toolExecutorMap[FEISHU]).toBeUndefined();
  });
});
