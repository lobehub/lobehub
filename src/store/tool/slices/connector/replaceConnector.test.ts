import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { restoreConnector, snapshotReplacedConnector } from './replaceConnector';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { connector: { syncToolsFromClientById: { mutate: vi.fn() } } },
}));

const makeStore = (connectors: Record<string, unknown>[]) => {
  const state = {
    connectors,
    fetchConnectors: vi.fn().mockResolvedValue(undefined),
    getConnectorForEdit: vi.fn(async (id: string) => ({ id, snapshot: true })),
    syncConnectorTools: vi.fn().mockResolvedValue(undefined),
    updateConnector: vi.fn().mockResolvedValue(undefined),
  };
  return { get: () => state as never, state };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('snapshotReplacedConnector', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'c1',
    identifier: 'gmail',
    mcpConnectionType: null,
    mcpServerUrl: null,
    metadata: {},
    ...over,
  });

  it.each([
    { case: 'a builtin tool', existing: row({ sourceType: 'builtin' }), source: 'custom' },
    { case: 'a builtin tool', existing: row({ sourceType: 'builtin' }), source: 'marketplace' },
    {
      case: 'a Composio connection',
      existing: row({
        metadata: { composio: { connectedAccountId: 'ca_1' } },
        sourceType: 'marketplace',
      }),
      source: 'custom',
    },
    {
      case: 'a Composio connection',
      existing: row({
        metadata: { composio: { connectedAccountId: 'ca_1' } },
        sourceType: 'marketplace',
      }),
      source: 'marketplace',
    },
    {
      case: 'an MCP server from another source',
      existing: row({ mcpConnectionType: 'http', mcpServerUrl: 'https://x', sourceType: 'custom' }),
      source: 'marketplace',
    },
  ] as const)('refuses to replace $case with a $source install', async ({ existing, source }) => {
    const { get, state } = makeStore([existing]);

    await expect(snapshotReplacedConnector('gmail', source, get)).rejects.toThrow('already exists');
    expect(state.getConnectorForEdit).not.toHaveBeenCalled();
  });

  it.each([
    {
      case: 'a legacy plugin projection',
      existing: row({ sourceType: 'marketplace' }),
      source: 'custom',
    },
    {
      case: 'its own source',
      existing: row({ mcpConnectionType: 'http', mcpServerUrl: 'https://x', sourceType: 'custom' }),
      source: 'custom',
    },
  ] as const)('snapshots $case for a $source install', async ({ existing, source }) => {
    const { get } = makeStore([existing]);

    await expect(snapshotReplacedConnector('gmail', source, get)).resolves.toEqual({
      id: 'c1',
      snapshot: true,
    });
  });
});

describe('restoreConnector', () => {
  const snapshot = (over: Record<string, unknown> = {}) =>
    ({
      credentials: null,
      id: 'c1',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://old.example.com',
      mcpStdioConfig: null,
      metadata: { marketplaceInstalled: true },
      name: 'Old MCP',
      oidcConfig: null,
      status: 'connected',
      tools: [{ description: null, inputSchema: null, metadata: null, toolName: 'search' }],
      ...over,
    }) as never;

  it('puts back a non-OAuth row, drops the OAuth client it gained and re-marks it connected', async () => {
    const { get, state } = makeStore([{ id: 'c1', mcpServerUrl: 'https://new.example.com' }]);
    const bearer = { token: 'old', type: 'bearer' };

    await restoreConnector(snapshot({ credentials: bearer }), get);

    expect(state.updateConnector).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        credentials: bearer,
        mcpServerUrl: 'https://old.example.com',
        oidcConfig: null,
      }),
    );
    // Its own tool list replaces the one the failed install synced
    expect(lambdaClient.connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
      id: 'c1',
      pruneMissingAutoTools: true,
      tools: [expect.objectContaining({ toolName: 'search' })],
    });
    expect(state.syncConnectorTools).not.toHaveBeenCalled();
  });

  // The sync rebuilds metadata from what it is sent: a rollback that dropped
  // the mark would leave an `always` tool on a `required` auto-run skips
  it('keeps the mandatory approval of a cloud tool the market made always', async () => {
    const { get } = makeStore([{ id: 'c1', mcpConnectionType: 'cloud', mcpServerUrl: null }]);

    await restoreConnector(
      snapshot({
        mcpConnectionType: 'cloud',
        mcpServerUrl: null,
        tools: [
          {
            description: 'Delete a repo',
            inputSchema: null,
            metadata: { mandatoryApproval: true, visibility: ['model'] },
            toolName: 'delete_repo',
          },
          { description: null, inputSchema: null, metadata: null, toolName: 'search' },
        ],
      }),
      get,
    );

    expect(lambdaClient.connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
      id: 'c1',
      pruneMissingAutoTools: true,
      tools: [
        {
          description: 'Delete a repo',
          humanIntervention: 'always',
          inputSchema: undefined,
          toolName: 'delete_repo',
          visibility: ['model'],
        },
        {
          description: undefined,
          humanIntervention: undefined,
          inputSchema: undefined,
          toolName: 'search',
          visibility: undefined,
        },
      ],
    });
  });

  describe('an OAuth row, whose tokens the edit read withholds', () => {
    const oauth = { oidcConfig: { clientId: 'client', scheme: 'dcr' } };

    it('keeps the tokens it holds on the same endpoint and asks its server', async () => {
      const { get, state } = makeStore([{ id: 'c1', mcpServerUrl: 'https://old.example.com' }]);

      await restoreConnector(snapshot(oauth), get);

      const patch = state.updateConnector.mock.calls[0][1];
      expect(patch).not.toHaveProperty('credentials');
      expect(patch).not.toHaveProperty('oidcConfig');
      // Never re-marked connected on the strength of a tool list alone
      expect(lambdaClient.connector.syncToolsFromClientById.mutate).not.toHaveBeenCalled();
      expect(state.syncConnectorTools).toHaveBeenCalledWith('c1', { pruneMissingAutoTools: true });
    });

    it('drops the tokens of the endpoint it moves back off', async () => {
      const { get, state } = makeStore([{ id: 'c1', mcpServerUrl: 'https://new.example.com' }]);
      state.syncConnectorTools.mockRejectedValue(new Error('401'));

      await expect(restoreConnector(snapshot(oauth), get)).resolves.toBeUndefined();

      expect(state.updateConnector).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ credentials: null, mcpServerUrl: 'https://old.example.com' }),
      );
    });
  });

  it('clears the endpoint a failed install wrote over an endpoint-less legacy projection', async () => {
    const { get, state } = makeStore([{ id: 'c1', mcpServerUrl: 'https://new.example.com' }]);

    await restoreConnector(
      snapshot({ mcpConnectionType: null, mcpServerUrl: null, mcpStdioConfig: null }),
      get,
    );

    expect(state.updateConnector).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        mcpConnectionType: null,
        mcpServerUrl: null,
        mcpStdioConfig: null,
      }),
    );
  });

  it('puts back the marketplace source a failed custom install moved the row off', async () => {
    const { get, state } = makeStore([
      { id: 'c1', mcpServerUrl: 'https://new.example.com', sourceType: 'custom' },
    ]);

    await restoreConnector(
      snapshot({
        mcpConnectionType: null,
        mcpServerUrl: null,
        sourceType: 'marketplace',
      }),
      get,
    );

    expect(state.updateConnector).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ mcpServerUrl: null, sourceType: 'marketplace' }),
    );
  });

  it('leaves a row that was not connected disconnected', async () => {
    const { get, state } = makeStore([{ id: 'c1', mcpServerUrl: 'https://old.example.com' }]);

    await restoreConnector(snapshot({ status: 'disconnected' }), get);

    expect(state.updateConnector).toHaveBeenCalled();
    expect(lambdaClient.connector.syncToolsFromClientById.mutate).not.toHaveBeenCalled();
    expect(state.syncConnectorTools).not.toHaveBeenCalled();
  });
});
