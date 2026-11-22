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

  it('keeps a private reinstall over a legacy row listed, a tool set of its own', () => {
    // Regression: made private, the reinstall vanished from the Private tab:
    // the list hid it behind its legacy plugin, which only the Workspace tab shows
    const privateRow = { ...marked, visibility: 'private' as const };
    const withLegacyRow = state({
      connectors: [privateRow],
      installedPlugins: [{ identifier: 'oauth-market' }] as never,
    });

    expect(connectorSelectors.marketplaceMcpConnectors(withLegacyRow)).toEqual([privateRow]);
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

  it("resolves each row by its own tool prefix: the shared one's and the private one's", () => {
    const privateRow = connector({ id: '3f9a1c2e-private', visibility: 'private' });
    const sharedRow = connector({ id: 'shared-row', visibility: 'public' });
    // The shared row listed first: physical order is not a ranking
    const s = state([sharedRow, privateRow]);

    // The connector's identifier names the shared row's tool set, in any run
    for (const includePrivate of [true, false]) {
      expect(
        connectorSelectors.connectorByIdentifierForAgent('oauth-market', 'agt_a', {
          includePrivate,
        })(s)?.id,
      ).toBe('shared-row');
    }
    // The private row is a tool set of its own, under its suffixed prefix
    expect(
      connectorSelectors.connectorByIdentifierForAgent('oauth-market-3f9a1c2e', 'agt_a', {
        includePrivate: true,
      })(s)?.id,
    ).toBe('3f9a1c2e-private');
    // ... which a run that may not use it never resolves
    expect(
      connectorSelectors.connectorByIdentifierForAgent('oauth-market-3f9a1c2e', 'agt_a', {
        includePrivate: false,
      })(s),
    ).toBe(undefined);
  });

  it('resolves a private row mounted on the agent by its own prefix, never the bare one', () => {
    const mounted = connector({
      id: '3f9a1c2e-mounted',
      metadata: { mountedByAgentId: 'agt_a' },
      visibility: 'private',
    });
    const s = { ...state([mounted]), agentConnectors: { agt_a: [mounted] } } as never;

    expect(
      connectorSelectors.connectorByIdentifierForAgent('oauth-market-3f9a1c2e', 'agt_a')(s)?.id,
    ).toBe('3f9a1c2e-mounted');
    expect(connectorSelectors.connectorByIdentifierForAgent('oauth-market', 'agt_a')(s)).toBe(
      undefined,
    );
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

describe('connector link names across replica pools', () => {
  // Every legacy connector's account is `lnk_default`: a name must come from the
  // connector the call runs on, not the first one holding that id
  it('names a shared account id after the connector a tool call runs on', () => {
    const legacy = (id: string, identifier: string, name: string, agentId?: string) =>
      connector({ agentId, id, identifier, links: [{ id: 'lnk_default', name } as any] });
    const state = {
      connectors: [legacy('a', 'work-mail', 'Work'), legacy('b', 'home-mail', 'Personal')],
      agentConnectors: { agt_x: [legacy('c', 'home-mail', 'Agent copy', 'agt_x')] },
    } as unknown as ToolStore;

    expect(connectorSelectors.connectorLinkNameForTool('home-mail', 'lnk_default')(state)).toBe(
      'Personal',
    );
    expect(connectorSelectors.connectorLinkNameForTool('work-mail', 'lnk_default')(state)).toBe(
      'Work',
    );
    // An agent's own copy wins, as it does when the call resolves its connector
    expect(
      connectorSelectors.connectorLinkNameForTool('home-mail', 'lnk_default', 'agt_x')(state),
    ).toBe('Agent copy');
    expect(
      connectorSelectors.connectorLinkNameForTool('unknown', 'lnk_default')(state),
    ).toBeUndefined();
  });

  it('resolves base, aggregate and per-agent links and preserves unknown IDs', () => {
    const make = (id: string) => connector({ id, links: [{ id: `lnk_${id}`, name: id } as any] });
    const state = {
      connectors: [make('base')],
      agentBoundConnectors: [make('aggregate')],
      agentConnectors: { agent: [make('agent')] },
    } as unknown as ToolStore;
    for (const name of ['base', 'aggregate', 'agent'])
      expect(connectorSelectors.connectorLinkName(name, `lnk_${name}`)(state)).toBe(name);
    expect(connectorSelectors.connectorLinkName('base', 'missing')(state)).toBeUndefined();
    expect(connectorSelectors.connectorLinkName('agent', 'lnk_base')(state)).toBeUndefined();
    expect(
      buildClientConnectorManifests([
        connector({
          links: [
            { id: 'a', name: 'Alice' },
            { id: 'b', name: 'Bob' },
          ] as any,
        }),
      ])[0].api[0].parameters.required,
    ).toContain('link_id');
  });
});
