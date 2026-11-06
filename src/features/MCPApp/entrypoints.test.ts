import { describe, expect, it } from 'vitest';

import type { ToolStore } from '@/store/tool/store';

import { mcpEntryTabKey, parseMcpEntryTab, selectMcpAppEntrypoints } from './entrypoints';

const entry = { title: 'Notes', toolName: 'open' };
const state = {
  installedPlugins: [{ identifier: 'notes', manifest: { mcpAppEntrypoints: [entry] } }],
  connectors: [],
  agentConnectors: {},
} as unknown as ToolStore;
describe('sidebar app entries', () => {
  it('does not read any installed metadata when disabled', () => {
    const inaccessible = new Proxy(
      {},
      {
        get() {
          throw new Error('must not inspect');
        },
      },
    );
    expect(selectMcpAppEntrypoints(inaccessible as ToolStore, false)).toEqual([]);
    expect(selectMcpAppEntrypoints(state, true)).toEqual([{ ...entry, identifier: 'notes' }]);
  });
  it('uses the agent connector and hides disabled tools even if a plugin declares the entry', () => {
    const connector = {
      id: 'agent-copy',
      agentId: 'agent',
      identifier: 'notes',
      isEnabled: true,
      mcpServerUrl: 'https://example.com',
      tools: [{ toolName: 'open', permission: 'disabled', metadata: { threadEntry: entry } }],
    };
    const scoped = { ...state, agentConnectors: { agent: [connector] } } as unknown as ToolStore;
    expect(selectMcpAppEntrypoints(scoped, true, 'agent')).toEqual([]);
  });
  it('round trips entry identifiers containing colons and rejects malformed tabs', () => {
    expect(parseMcpEntryTab(mcpEntryTabKey('notes:mine', 'open/page'))).toEqual({
      identifier: 'notes:mine',
      toolName: 'open/page',
    });
    expect(parseMcpEntryTab('mcp-entry:bad:%XX')).toBeUndefined();
  });
});
