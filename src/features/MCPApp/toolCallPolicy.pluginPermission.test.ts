import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppToolCallPolicy } from './toolCallPolicy';

/**
 * A plugin-backed MCP keeps its bare identifier on every call, while its tool
 * permissions live on endpoint-less connector rows of that identifier: the
 * workspace's shared row and the caller's private one. The permission is the
 * one the conversation runs by, never only the row the bare identifier names.
 */
const { listed, toolState } = vi.hoisted(() => ({
  listed: { rows: undefined as unknown[] | undefined },
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
    getInstalledPluginById: (id: string) => () =>
      id === 'notes'
        ? { identifier: 'notes', manifest: { api: [{ name: 'delete_note' }] } }
        : undefined,
    isInstalledPluginsServerConfirmed: () => true,
  },
}));
vi.mock('@/services/runConnectors', () => ({
  getAllRunConnectors: () => listed.rows ?? [],
  getRunConnectors: () => listed.rows,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { connector: { resolveForRun: { query: vi.fn().mockResolvedValue(null) } } },
}));
vi.mock('@/store/user', () => ({ getUserStoreState: () => ({}) }));
vi.mock('@/store/user/selectors', () => ({
  toolInterventionSelectors: { allowList: () => [], approvalMode: () => 'manual' },
}));

const permissionRow = (id: string, visibility: 'private' | 'public', permission: string) => ({
  agentId: null,
  id,
  identifier: 'notes',
  isEnabled: true,
  metadata: null,
  tools: [{ permission, toolName: 'delete_note' }],
  visibility,
});

describe('getAppToolCallPolicy — a plugin tool with private and shared permission rows', () => {
  const shared = permissionRow('conn-shared', 'public', 'auto');
  const mine = permissionRow('conn-mine', 'private', 'disabled');

  beforeEach(() => {
    toolState.connectors = [shared, mine];
    listed.rows = undefined;
  });

  it("refuses a tool the caller's private row disables when the run's rows are unknown", async () => {
    // Regression: the plugin's permission was read from the row the bare
    // identifier names (the shared one), so the private `disabled` setting
    // the owner's own conversation runs by was dropped and the view allowed.
    expect(
      await getAppToolCallPolicy('notes', 'delete_note', {
        agentId: 'agt_private',
        topicId: 'tpc_own',
      }),
    ).toBe('deny');
  });

  it("follows the private row when the conversation's listing holds it", async () => {
    listed.rows = [
      { ...shared, toolIdentifier: 'notes' },
      { ...mine, toolIdentifier: 'notes-connmine' },
    ];

    expect(
      await getAppToolCallPolicy('notes', 'delete_note', {
        agentId: 'agt_private',
        topicId: 'tpc_own',
      }),
    ).toBe('deny');
  });

  it('follows the shared row when the listing leaves the private one out', async () => {
    listed.rows = [{ ...shared, toolIdentifier: 'notes' }];

    expect(
      await getAppToolCallPolicy('notes', 'delete_note', {
        agentId: 'agt_public',
        topicId: 'tpc_1',
      }),
    ).not.toBe('deny');
  });
});
