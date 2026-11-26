import { describe, expect, it } from 'vitest';

import { initialState } from '@/store/tool/initialState';
import type { ConnectorWithTools } from '@/store/tool/slices/connector';

import { getInstalledMcpItems } from './installedMcps';

describe('getInstalledMcpItems', () => {
  it('opens the correct installation for a legacy shared server and a private server with the same identifier', () => {
    const shared: ConnectorWithTools = {
      credentials: null,
      id: 'shared',
      identifier: 'notes',
      isEnabled: true,
      mcpConnectionType: 'stdio',
      mcpServerUrl: null,
      metadata: { marketplaceInstalled: true },
      name: 'Notes',
      sourceType: 'marketplace',
      status: 'connected',
      tools: [],
      visibility: 'public',
    };
    const installed = getInstalledMcpItems({
      ...initialState,
      connectors: [
        shared,
        { ...shared, id: 'private', visibility: 'private' },
        { ...shared, id: 'pending', identifier: 'pending', metadata: {} },
        { ...shared, id: 'custom', identifier: 'calendar', sourceType: 'custom' },
      ],
      installedPlugins: [{ identifier: 'notes', type: 'plugin' }],
    });
    expect(installed.map((item) => item.path)).toEqual([
      '/marketplace/mcp/installed?open=plugin%3Anotes',
      '/marketplace/mcp/installed?open=mcp-connector%3Acalendar',
      '/marketplace/mcp/installed?open=mcp-connector%3Anotes&visibility=private',
    ]);
  });
});
