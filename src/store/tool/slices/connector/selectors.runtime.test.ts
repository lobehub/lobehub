import { describe, expect, it } from 'vitest';

import { buildClientConnectorManifests } from '@/helpers/toolEngineering/buildClientConnectorManifests';
import type { ToolStore } from '@/store/tool/store';

import { connectorSelectors } from './selectors';
import type { ConnectorWithTools } from './types';

const connector = (patch: Partial<ConnectorWithTools>): ConnectorWithTools => ({
  credentials: null,
  id: 'c1',
  identifier: 'oauth-market',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://oauth.example/mcp',
  metadata: null,
  name: 'OAuth market',
  sourceType: 'marketplace',
  status: 'connected',
  tools: [
    {
      crudType: 'read',
      description: 'Read tasks',
      displayName: null,
      id: 't1',
      inputSchema: { type: 'object' },
      permission: 'auto',
      toolName: 'read_tasks',
      userConnectorId: 'c1',
    },
  ],
  ...patch,
});

describe('marketplace MCP runtime manifests', () => {
  it('offers connected OAuth marketplace tools with the connector executor', () => {
    const state = {
      connectors: [connector({})],
      installedPlugins: [{ identifier: 'oauth-market' }],
    } as ToolStore;
    const manifests = buildClientConnectorManifests(
      connectorSelectors.executableMcpConnectors(state),
    );
    expect(manifests.map((manifest) => manifest.identifier)).toEqual(['oauth-market']);
    expect(manifests[0].api.map((api) => api.name)).toEqual(['read_tasks']);
    expect(manifests[0]).not.toHaveProperty('mcpParams');
  });
  it('does not replace other marketplace executors or expose disconnected OAuth tools', () => {
    const state = {
      connectors: [connector({ mcpServerUrl: null }), connector({ status: 'disconnected' })],
    } as ToolStore;
    expect(
      buildClientConnectorManifests(connectorSelectors.executableMcpConnectors(state)),
    ).toEqual([]);
  });

  it('does not expose tools from an OAuth callback that arrived after cancellation', () => {
    const state = { connectors: [connector({})], installedPlugins: [] } as unknown as ToolStore;
    expect(
      buildClientConnectorManifests(connectorSelectors.executableMcpConnectors(state)),
    ).toEqual([]);
  });

  it('offers a finished connector install of any transport without a plugin row', () => {
    const marked = { marketplaceInstalled: true };
    const state = {
      connectors: [
        connector({ id: 'http', identifier: 'http-mcp', metadata: marked }),
        connector({
          id: 'stdio',
          identifier: 'stdio-mcp',
          mcpConnectionType: 'stdio',
          mcpServerUrl: null,
          metadata: marked,
        }),
        connector({
          id: 'cloud',
          identifier: 'cloud-mcp',
          mcpConnectionType: 'cloud',
          mcpServerUrl: null,
          metadata: marked,
        }),
      ],
      installedPlugins: [],
    } as unknown as ToolStore;
    expect(connectorSelectors.executableMcpConnectors(state).map((c) => c.identifier)).toEqual([
      'http-mcp',
      'stdio-mcp',
      'cloud-mcp',
    ]);
  });
});

describe('marketplace MCPs installed as connectors', () => {
  const marked = connector({ metadata: { marketplaceInstalled: true } });
  const state = (patch: Partial<ToolStore>) =>
    ({ connectors: [], installedPlugins: [], ...patch }) as unknown as ToolStore;

  it('counts only a finished install as installed', () => {
    expect(
      connectorSelectors.isMarketplaceConnectorInstalled('oauth-market')(
        state({ connectors: [marked] }),
      ),
    ).toBe(true);
    // A connected OAuth row without the install mark is not an install
    expect(
      connectorSelectors.isMarketplaceConnectorInstalled('oauth-market')(
        state({ connectors: [connector({})] }),
      ),
    ).toBe(false);
  });

  it('lists a connector install beside custom connectors unless a legacy row lists it', () => {
    const custom = connector({ id: 'custom', identifier: 'my-mcp', sourceType: 'custom' });
    expect(
      connectorSelectors
        .userMcpConnectors(state({ connectors: [custom, marked] }))
        .map((c) => c.identifier),
    ).toEqual(['my-mcp', 'oauth-market']);
    expect(
      connectorSelectors
        .userMcpConnectors(
          state({
            connectors: [custom, marked],
            installedPlugins: [{ identifier: 'oauth-market' }] as never,
          }),
        )
        .map((c) => c.identifier),
    ).toEqual(['my-mcp']);
  });

  it('resolves the connector a reinstall over a legacy row runs on, for its settings', () => {
    const withLegacyRow = state({
      connectors: [marked],
      installedPlugins: [{ identifier: 'oauth-market' }] as never,
    });

    // The list shows the legacy plugin, but its tools run on the connector
    expect(connectorSelectors.marketplaceMcpConnectors(withLegacyRow)).toEqual([]);
    expect(
      connectorSelectors.marketplaceMcpConnectorByIdentifier('oauth-market')(withLegacyRow),
    ).toBe(marked);
  });

  it('resolves no connector for a row that only projects a plugin or comes from another source', () => {
    const projection = connector({ mcpConnectionType: null, mcpServerUrl: null });
    const custom = connector({ sourceType: 'custom' });

    for (const row of [projection, custom]) {
      expect(
        connectorSelectors.marketplaceMcpConnectorByIdentifier('oauth-market')(
          state({ connectors: [row] }),
        ),
      ).toBeUndefined();
    }
  });
});

describe('connectorSelectors.connectorByIdentifierForAgent', () => {
  const state = (connectors: ConnectorWithTools[], agentConnectors = {}) =>
    ({ agentConnectors, connectors }) as unknown as ToolStore;
  const mountedBy = (agentId: string) =>
    connector({ id: 'base', metadata: { mountedByAgentId: agentId } });

  it('does not hand one agent a base connector another agent mounted', () => {
    const s = state([mountedBy('agt_b')]);

    expect(connectorSelectors.connectorByIdentifierForAgent('oauth-market', 'agt_a')(s)).toBe(
      undefined,
    );
    // Nor a call that names no agent at all
    expect(connectorSelectors.connectorByIdentifierForAgent('oauth-market')(s)).toBe(undefined);
  });

  it('resolves a base connector that is free or mounted by this agent', () => {
    expect(
      connectorSelectors.connectorByIdentifierForAgent(
        'oauth-market',
        'agt_a',
      )(state([mountedBy('agt_a')]))?.id,
    ).toBe('base');
    expect(
      connectorSelectors.connectorByIdentifierForAgent('oauth-market')(state([connector({})]))?.id,
    ).toBe('c1');
  });
});
