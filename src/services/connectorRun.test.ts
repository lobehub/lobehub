import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRunConnector } from './connectorRun';

/**
 * Which row a conversation's connector call runs on. In a workspace a private
 * agent's own topic may run its owner's personal connector, which none of the
 * client's workspace lists hold, so only the server can name it.
 */
const { resolveForRun, state } = vi.hoisted(() => ({
  resolveForRun: vi.fn(),
  state: {
    toolStore: { agentConnectors: {}, connectors: [] as unknown[] },
    workspaceId: null as string | null,
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => state.workspaceId,
}));
vi.mock('@/store/tool/store', () => ({ getToolStoreState: () => state.toolStore }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { connector: { resolveForRun: { query: resolveForRun } } },
}));

const sharedHttp = {
  agentId: null,
  id: 'conn-shared',
  identifier: 'files',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example.com/mcp',
  metadata: null,
  tools: [{ permission: 'auto', toolName: 'read_file' }],
  visibility: 'public',
};
const personalStdio = {
  id: 'conn-personal',
  identifier: 'files',
  isEnabled: true,
  mcpConnectionType: 'stdio',
  mcpServerUrl: null,
  tools: [{ permission: 'auto', toolName: 'read_file' }],
};
const run = { agentId: 'agt_private', topicId: 'tpc_own' };

describe('resolveRunConnector', () => {
  beforeEach(() => {
    resolveForRun.mockReset();
    state.toolStore.connectors = [];
    state.workspaceId = 'ws-1';
  });

  it.each([
    { connectors: [], lists: 'no row' },
    { connectors: [sharedHttp], lists: 'only the shared row' },
  ])(
    "returns the owner's personal connector the server runs when the lists hold $lists",
    async ({ connectors }) => {
      // Regression: both picks agreed (on no row, or on the shared one), so the
      // server was never asked. A desktop then sent the personal stdio call to
      // the server, which cannot run a stdio connector.
      state.toolStore.connectors = connectors;
      resolveForRun.mockResolvedValue(personalStdio);

      await expect(resolveRunConnector('files', run)).resolves.toEqual(personalStdio);
      expect(resolveForRun).toHaveBeenCalledWith({ ...run, identifier: 'files' });
    },
  );

  it("keeps the lists' copy of a row they hold", async () => {
    state.toolStore.connectors = [sharedHttp];
    resolveForRun.mockResolvedValue({ ...sharedHttp, tools: [] });

    await expect(resolveRunConnector('files', run)).resolves.toBe(sharedHttp);
  });

  it('resolves nothing when the server runs no row', async () => {
    state.toolStore.connectors = [sharedHttp];
    resolveForRun.mockResolvedValue(null);

    await expect(resolveRunConnector('files', run)).resolves.toBeUndefined();
  });

  it('trusts agreeing picks outside a workspace, where nothing is private', async () => {
    state.workspaceId = null;
    state.toolStore.connectors = [sharedHttp];

    await expect(resolveRunConnector('files', run)).resolves.toBe(sharedHttp);
    expect(resolveForRun).not.toHaveBeenCalled();
  });

  it('never asks the server without a conversation', async () => {
    state.toolStore.connectors = [sharedHttp];

    await expect(resolveRunConnector('files', { agentId: 'agt_private' })).resolves.toBe(
      sharedHttp,
    );
    expect(resolveForRun).not.toHaveBeenCalled();
  });
});
