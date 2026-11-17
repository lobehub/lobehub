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

interface RunOptions {
  chatConfig?: Record<string, unknown>;
  hasMentionedAgents?: boolean;
}

const run = (options: RunOptions = {}) =>
  discoverTools(
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
      pluginModel: { query: vi.fn().mockResolvedValue([]) },
      userId: 'user-1',
    } as never,
    {
      agentConfig: { chatConfig: options.chatConfig ?? {}, plugins: [] },
      appContext: undefined,
      canUseDevice: false,
      model: 'test-model',
      prompt: 'ask @Designer to draft a logo',
      provider: 'test-provider',
      resolvedAgentId: 'agent-1',
      runFacts: {
        deviceSystemInfo: vi.fn().mockResolvedValue(undefined),
        userPreference: vi.fn().mockResolvedValue(undefined),
      },
      shareGate: undefined,
    } as never,
    {
      disabledPluginIds: [],
      globalMemoryEnabled: false,
      hasMentionedAgents: options.hasMentionedAgents ?? false,
      isFixedDeviceTarget: false,
      loadHistoryMessages: vi.fn().mockResolvedValue([]),
      throwIfExecutionAborted: vi.fn(),
    } as never,
  );

const offeredToolNames = (result: { tools?: { function: { name: string } }[] }) =>
  (result.tools ?? []).map((tool) => tool.function.name);

/**
 * @mentioned agents are delegated to with `lobe-agent.callSubAgent({ agentId })`
 * — `lobe-agent-management.callAgent` is retired and never offered.
 */
describe('discoverTools — @mentioned agents', () => {
  it('offers callSubAgent with agentId in agent mode, never callAgent', async () => {
    const result = await run({ hasMentionedAgents: true });
    const names = offeredToolNames(result);

    expect(names).toContain('lobe-agent____callSubAgent');
    expect(names).not.toContain('lobe-agent-management____callAgent');
    expect(names).toContain('lobe-agent____createPlan');
  });

  // Chat mode carries no default tools, so a mention brings in only the
  // delegation-only lobe-agent.
  it('offers only the delegation API in chat mode when agents are mentioned', async () => {
    const result = await run({ chatConfig: { enableAgentMode: false }, hasMentionedAgents: true });
    const lobeAgentTools = offeredToolNames(result).filter((name) =>
      name.startsWith('lobe-agent____'),
    );

    expect(lobeAgentTools).toEqual(['lobe-agent____callSubAgent']);
    expect(result.toolManifestMap['lobe-agent']?.api[0].parameters.required).toContain('agentId');
  });

  it('offers no lobe-agent in chat mode without a mention', async () => {
    const result = await run({ chatConfig: { enableAgentMode: false } });

    expect(offeredToolNames(result).some((name) => name.startsWith('lobe-agent____'))).toBe(false);
  });
});
