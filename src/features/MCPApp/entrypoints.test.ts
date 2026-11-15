import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolStore } from '@/store/tool/store';

import { mcpEntryTabKey, parseMcpEntryTab, selectMcpAppEntrypoints } from './entrypoints';

const env = vi.hoisted(() => ({ desktop: false }));
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return env.desktop;
  },
}));
afterEach(() => {
  env.desktop = false;
});

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
  it('offers apps only a desktop can run (stdio) on the desktop alone', () => {
    const open = { title: 'Local', toolName: 'open' };
    const desktopOnly = {
      ...state,
      agentConnectors: {},
      connectors: [
        {
          id: 'local',
          identifier: 'local-connector',
          isEnabled: true,
          mcpConnectionType: 'stdio',
          tools: [{ metadata: { threadEntry: open }, permission: 'auto', toolName: 'open' }],
        },
      ],
      installedPlugins: [
        ...(state.installedPlugins as object[]),
        {
          customParams: { mcp: { command: 'local-mcp', type: 'stdio' } },
          identifier: 'local-plugin',
          manifest: { mcpAppEntrypoints: [open] },
        },
      ],
    } as unknown as ToolStore;

    // The remote plugin stays; both stdio apps are left out on the web
    expect(selectMcpAppEntrypoints(desktopOnly, true).map((item) => item.identifier)).toEqual([
      'notes',
    ]);

    env.desktop = true;
    expect(selectMcpAppEntrypoints(desktopOnly, true).map((item) => item.identifier)).toEqual([
      'notes',
      'local-plugin',
      'local-connector',
    ]);
  });
});
