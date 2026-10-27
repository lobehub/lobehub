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
});
