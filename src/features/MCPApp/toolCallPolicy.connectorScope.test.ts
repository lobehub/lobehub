import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppToolCallPolicy } from './toolCallPolicy';

/**
 * Which connector a view's call is approved against, with the real resolution
 * (`resolveRunConnector` over the real connector selectors): the caller holds a
 * private and a shared row of the same identifier, and only the server knows
 * which one the conversation runs.
 */
const { resolveForRun, toolState } = vi.hoisted(() => ({
  resolveForRun: vi.fn(),
  toolState: {
    agentConnectors: {} as Record<string, unknown[]>,
    connectors: [] as unknown[],
    ensureConfirmedConnectors: async () => {},
    isConnectorListConfirmed: () => true,
    syncConnectorTools: async () => {},
  },
}));

vi.mock('@/store/tool', () => ({ getToolStoreState: () => toolState }));
vi.mock('@/store/tool/store', () => ({ getToolStoreState: () => toolState }));
vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: {
    getCustomPluginById: () => () => undefined,
    getInstalledPluginById: () => () => undefined,
  },
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { connector: { resolveForRun: { query: resolveForRun } } },
}));
vi.mock('@/store/user', () => ({ getUserStoreState: () => ({}) }));
vi.mock('@/store/user/selectors', () => ({
  toolInterventionSelectors: { allowList: () => [], approvalMode: () => 'manual' },
}));

const mailRow = (id: string, visibility: 'private' | 'public', permission: string) => ({
  agentId: null,
  id,
  identifier: 'mail',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example.com/mcp',
  metadata: null,
  tools: [{ permission, toolName: 'send' }],
  visibility,
});

describe('getAppToolCallPolicy — private and shared rows of one connector', () => {
  beforeEach(() => {
    resolveForRun.mockReset();
    toolState.connectors = [
      // The caller's own private row runs `send` automatically…
      mailRow('conn-private', 'private', 'auto'),
      // …the workspace's shared row asks first
      mailRow('conn-shared', 'public', 'needs_approval'),
    ];
  });

  it('asks when the conversation runs the shared row, though the private one would not', async () => {
    // Regression: the policy ranked the private row first for any agent, so a
    // public agent's view ran the shared tool with no approval while the server
    // executed the shared row, which needs one.
    resolveForRun.mockResolvedValue({ id: 'conn-shared' });

    expect(
      await getAppToolCallPolicy('mail', 'send', { agentId: 'agt_public', topicId: 'tpc_1' }),
    ).toBe('confirm');
    expect(resolveForRun).toHaveBeenCalledWith({
      agentId: 'agt_public',
      identifier: 'mail',
      topicId: 'tpc_1',
    });
  });

  it("follows the private row when the server runs it in the agent's own topic", async () => {
    resolveForRun.mockResolvedValue({ id: 'conn-private' });

    expect(
      await getAppToolCallPolicy('mail', 'send', { agentId: 'agt_private', topicId: 'tpc_own' }),
    ).toBe('allow');
  });

  it('judges the shared row without asking the server when the call names no topic', async () => {
    expect(await getAppToolCallPolicy('mail', 'send', { agentId: 'agt_private' })).toBe('confirm');
    expect(resolveForRun).not.toHaveBeenCalled();
  });

  it("asks when the server can't say which row runs", async () => {
    resolveForRun.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      await getAppToolCallPolicy('mail', 'send', { agentId: 'agt_private', topicId: 'tpc_own' }),
    ).toBe('confirm');
  });
});
