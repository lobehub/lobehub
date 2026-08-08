// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { PluginModel } from '@/database/models/plugin';

import { loadConnectedComposioIds } from './composioConnectedIds';

vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));

describe('loadConnectedComposioIds', () => {
  // Regression: agent-scoped Composio connections are NOT projected into the
  // plugin table, so the plugin-only read reported them "not connected" and the
  // model re-ran the OAuth connect flow (`connectComposioService`) even though a
  // valid workspace-agent connection existed in `user_connectors`.
  let pluginModelMock: any;
  let connectorModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginModelMock = { query: vi.fn().mockResolvedValue([]) };
    connectorModelMock = { resolveAll: vi.fn().mockResolvedValue([]) };
    vi.mocked(PluginModel).mockImplementation(() => pluginModelMock);
    vi.mocked(ConnectorModel).mockImplementation(() => connectorModelMock);
  });

  it('includes an agent-scoped connector that is absent from the plugin table', async () => {
    pluginModelMock.query.mockResolvedValueOnce([]); // nothing projected to plugins
    connectorModelMock.resolveAll.mockResolvedValueOnce([
      {
        identifier: 'gmail',
        isEnabled: true,
        metadata: { composio: { connectedAccountId: 'ca_1', status: 'ACTIVE' } },
      },
    ]);

    const ids = await loadConnectedComposioIds({} as any, 'user_test', 'ws-1', 'agent-1');

    expect(ids.has('gmail')).toBe(true);
    // scoped to the caller's workspace + resolved agent-aware
    expect(ConnectorModel).toHaveBeenCalledWith(expect.anything(), 'user_test', 'ws-1');
    expect(connectorModelMock.resolveAll).toHaveBeenCalledWith('agent-1');
  });

  it('still counts a base connection projected into the plugin table', async () => {
    pluginModelMock.query.mockResolvedValueOnce([
      { customParams: { composio: { status: 'ACTIVE' } }, identifier: 'gmail' },
    ]);

    const ids = await loadConnectedComposioIds({} as any, 'user_test', undefined, undefined);

    expect(ids.has('gmail')).toBe(true);
  });

  it('excludes a disabled connector and a non-Composio identifier', async () => {
    connectorModelMock.resolveAll.mockResolvedValueOnce([
      { identifier: 'gmail', isEnabled: false, metadata: { composio: { status: 'ACTIVE' } } },
      {
        identifier: 'my-custom-mcp',
        isEnabled: true,
        metadata: { composio: { status: 'ACTIVE' } },
      },
    ]);

    const ids = await loadConnectedComposioIds({} as any, 'user_test', 'ws-1', 'agent-1');

    expect(ids.has('gmail')).toBe(false); // disabled connector row
    expect(ids.has('my-custom-mcp')).toBe(false); // not a Composio app type
  });

  it('excludes a non-ACTIVE connector (pending / failed)', async () => {
    connectorModelMock.resolveAll.mockResolvedValueOnce([
      { identifier: 'gmail', isEnabled: true, metadata: { composio: { status: 'PENDING' } } },
    ]);

    const ids = await loadConnectedComposioIds({} as any, 'user_test', 'ws-1', 'agent-1');

    expect(ids.has('gmail')).toBe(false);
  });

  it('falls back to the plugin-based set if the connector lookup throws', async () => {
    pluginModelMock.query.mockResolvedValueOnce([
      { customParams: { composio: { status: 'ACTIVE' } }, identifier: 'gmail' },
    ]);
    connectorModelMock.resolveAll.mockRejectedValueOnce(new Error('db down'));

    const ids = await loadConnectedComposioIds({} as any, 'user_test', 'ws-1', 'agent-1');

    expect(ids.has('gmail')).toBe(true); // plugin-based result survives the error
  });
});
