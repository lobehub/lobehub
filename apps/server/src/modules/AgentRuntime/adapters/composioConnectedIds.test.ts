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
    pluginModelMock = { queryComposioMirrors: vi.fn().mockResolvedValue([]) };
    connectorModelMock = {
      // Pass-through by default: every projection row is a legacy connection.
      pickLegacyComposioMirrors: vi.fn(async (mirrors: unknown[]) => mirrors),
      resolveAll: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(PluginModel).mockImplementation(function () {
      return pluginModelMock;
    });
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return connectorModelMock;
    });
  });

  it('includes an agent-scoped connector that is absent from the plugin table', async () => {
    pluginModelMock.queryComposioMirrors.mockResolvedValueOnce([]); // nothing projected to plugins
    connectorModelMock.resolveAll.mockResolvedValueOnce([
      {
        identifier: 'gmail',
        isEnabled: true,
        metadata: { composio: { connectedAccountId: 'ca_1', status: 'ACTIVE' } },
      },
    ]);

    const ids = await loadConnectedComposioIds({} as any, 'user_test', 'ws-1', {
      agentId: 'agent-1',
      topicId: 'tpc-1',
    });

    expect(ids.has('gmail')).toBe(true);
    // scoped to the caller's workspace + resolved agent-aware
    expect(ConnectorModel).toHaveBeenCalledWith(expect.anything(), 'user_test', 'ws-1');
    expect(connectorModelMock.resolveAll).toHaveBeenCalledWith({
      agentId: 'agent-1',
      topicId: 'tpc-1',
    });
  });

  const projection = (status: string, userId = 'user_test') => ({
    customParams: { composio: { connectedAccountId: 'ca_legacy', status } },
    identifier: 'gmail',
    userId,
  });

  it('still counts a legacy base connection projected into the plugin table', async () => {
    pluginModelMock.queryComposioMirrors.mockResolvedValueOnce([projection('ACTIVE')]);

    const ids = await loadConnectedComposioIds({} as any, 'user_test', undefined, {});

    expect(ids.has('gmail')).toBe(true);
    expect(connectorModelMock.pickLegacyComposioMirrors).toHaveBeenCalledWith([
      expect.objectContaining({
        connectedAccountId: 'ca_legacy',
        identifier: 'gmail',
        ownerUserId: 'user_test',
      }),
    ]);
  });

  // Regression: a teammate made the workspace's only Gmail connection private.
  // Its projection row stays ACTIVE and workspace-wide, but a workspace agent
  // does not load the private connector, so `ComposioService` serves it no
  // Gmail tool. Counting the row told the model Gmail was authorized and hid
  // it from the services it can connect.
  it('does not count a projection row that mirrors a connector the run does not load', async () => {
    pluginModelMock.queryComposioMirrors.mockResolvedValueOnce([projection('ACTIVE', 'mate')]);
    connectorModelMock.pickLegacyComposioMirrors.mockResolvedValueOnce([]);
    connectorModelMock.resolveAll.mockResolvedValueOnce([]); // private row is not resolved

    const ids = await loadConnectedComposioIds({} as any, 'user_test', 'ws-1', {
      agentId: 'workspace-agent',
      topicId: 'tpc-1',
    });

    expect(ids.has('gmail')).toBe(false);
    expect(connectorModelMock.pickLegacyComposioMirrors).toHaveBeenCalledWith([
      expect.objectContaining({ identifier: 'gmail', ownerUserId: 'mate' }),
    ]);
  });

  it('does not count an inactive legacy projection row', async () => {
    pluginModelMock.queryComposioMirrors.mockResolvedValueOnce([projection('EXPIRED')]);

    const ids = await loadConnectedComposioIds({} as any, 'user_test', undefined, {});

    expect(ids.has('gmail')).toBe(false);
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

    const ids = await loadConnectedComposioIds({} as any, 'user_test', 'ws-1', {
      agentId: 'agent-1',
      topicId: 'tpc-1',
    });

    expect(ids.has('gmail')).toBe(false); // disabled connector row
    expect(ids.has('my-custom-mcp')).toBe(false); // not a Composio app type
  });

  it('excludes a non-ACTIVE connector (pending / failed)', async () => {
    connectorModelMock.resolveAll.mockResolvedValueOnce([
      { identifier: 'gmail', isEnabled: true, metadata: { composio: { status: 'PENDING' } } },
    ]);

    const ids = await loadConnectedComposioIds({} as any, 'user_test', 'ws-1', {
      agentId: 'agent-1',
      topicId: 'tpc-1',
    });

    expect(ids.has('gmail')).toBe(false);
  });

  it('falls back to the plugin-based set if the connector lookup throws', async () => {
    pluginModelMock.queryComposioMirrors.mockResolvedValueOnce([projection('ACTIVE')]);
    connectorModelMock.resolveAll.mockRejectedValueOnce(new Error('db down'));

    const ids = await loadConnectedComposioIds({} as any, 'user_test', 'ws-1', {
      agentId: 'agent-1',
      topicId: 'tpc-1',
    });

    expect(ids.has('gmail')).toBe(true); // plugin-based result survives the error
  });
});
