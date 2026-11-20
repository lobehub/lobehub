import { ToolNameResolver } from '@lobechat/context-engine';
import { beforeEach, describe, expect, it } from 'vitest';

import { useToolStore } from '@/store/tool';

import { PluginInternalsActionImpl } from './internals';

// Marketplace and custom MCP installs land only in `user_connectors` now. The
// tools engine offers their tools; the names it generated must resolve back.
const identifier = 'acceptance-notes-mcp-server';
const apiName = 'search_notes_by_keyword_and_date_range';
const tool = {
  crudType: 'read',
  description: 'Search notes',
  displayName: null,
  id: 't1',
  inputSchema: { properties: { q: { type: 'string' } }, type: 'object' },
  permission: 'auto',
  toolName: apiName,
  userConnectorId: 'c1',
};
const marketplaceConnector = {
  id: 'c1',
  identifier,
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://notes.example.com/mcp',
  metadata: { marketplaceInstalled: true },
  name: 'Acceptance Notes',
  sourceType: 'marketplace',
  status: 'connected',
  tools: [tool],
};

const transform = (name: string) =>
  new PluginInternalsActionImpl(
    () => {},
    () => ({}) as never,
  ).internal_transformToolCalls([
    { function: { arguments: '{"q":"x"}', name }, id: 'call-1', type: 'function' },
  ]);

beforeEach(() => {
  useToolStore.setState({ connectors: [], installedPlugins: [] } as never);
});

describe('internal_transformToolCalls with connector-only MCPs', () => {
  it("resolves a connector tool's MD5-hashed wire name back to the connector", () => {
    useToolStore.setState({ connectors: [marketplaceConnector] } as never);
    const wireName = new ToolNameResolver().generate(identifier, apiName, 'mcp');
    expect(wireName).toContain('MD5HASH_');

    const [payload] = transform(wireName);

    expect(payload).toMatchObject({
      apiName,
      arguments: '{"q":"x"}',
      identifier,
      source: 'mcp',
      type: 'mcp',
    });
  });

  it('does not resolve the tools of an unfinished marketplace install', () => {
    useToolStore.setState({
      connectors: [{ ...marketplaceConnector, metadata: {}, status: 'disconnected' }],
    } as never);
    const wireName = new ToolNameResolver().generate(identifier, apiName, 'mcp');

    // Its tools are not offered either, so the hashed API name stays opaque
    expect(transform(wireName)[0]?.apiName).not.toBe(apiName);
  });
});
