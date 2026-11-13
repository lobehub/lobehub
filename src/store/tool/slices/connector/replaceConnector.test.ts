import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snapshotReplacedConnector } from './replaceConnector';

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
