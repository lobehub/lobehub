import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolStore } from '@/store/tool/store';

import {
  isEntryOfTab,
  mcpEntryTabKey,
  parseMcpEntryTab,
  selectMcpAppEntrypoints,
} from './entrypoints';

const env = vi.hoisted(() => ({ desktop: false, gateway: true }));
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return env.desktop;
  },
}));
vi.mock('@/store/serverConfig/store', () => ({
  getServerConfigStoreState: () => ({ serverConfig: { deviceGatewayConfigured: env.gateway } }),
}));
afterEach(() => {
  env.desktop = false;
  env.gateway = true;
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
  // An entrypoint's call carries no arguments, so it can't select an account
  it('offers an app once per account of a connector holding several', () => {
    const connector = (links: { id: string; name: string }[]) =>
      ({
        ...state,
        connectors: [
          {
            id: 'mail',
            identifier: 'mail',
            isEnabled: true,
            links,
            mcpServerUrl: 'https://example.com',
            tools: [{ metadata: { threadEntry: entry }, permission: 'auto', toolName: 'open' }],
          },
        ],
        installedPlugins: [],
      }) as unknown as ToolStore;

    expect(
      selectMcpAppEntrypoints(
        connector([
          { id: 'lnk_a', name: 'Work' },
          { id: 'lnk_b', name: 'Personal' },
        ]),
        true,
      ),
    ).toEqual([
      { ...entry, accountName: 'Work', identifier: 'mail', linkId: 'lnk_a' },
      { ...entry, accountName: 'Personal', identifier: 'mail', linkId: 'lnk_b' },
    ]);
    expect(selectMcpAppEntrypoints(connector([{ id: 'lnk_a', name: 'Work' }]), true)).toEqual([
      { ...entry, identifier: 'mail' },
    ]);
  });
  it("keeps an entry's account in its tab", () => {
    const tab = parseMcpEntryTab(mcpEntryTabKey('mail', 'open', 'lnk_b'));
    expect(tab).toEqual({ identifier: 'mail', linkId: 'lnk_b', toolName: 'open' });
    const base = { ...entry, identifier: 'mail' };
    expect(isEntryOfTab({ ...base, linkId: 'lnk_b' }, tab)).toBe(true);
    expect(isEntryOfTab({ ...base, linkId: 'lnk_a' }, tab)).toBe(false);
    expect(isEntryOfTab(base, parseMcpEntryTab(mcpEntryTabKey('mail', 'open')))).toBe(true);
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

  // The server tunnels their tool calls to the user's device, but not an app
  // view's calls: opening one on the web would always fail
  it('offers apps of servers that connect through the device on the desktop alone', () => {
    const open = { title: 'NAS', toolName: 'open' };
    const httpConnector = (identifier: string, mcpServerUrl: string, metadata?: object) => ({
      id: identifier,
      identifier,
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl,
      metadata,
      tools: [{ metadata: { threadEntry: open }, permission: 'auto', toolName: 'open' }],
    });
    const deviceRouted = {
      ...state,
      agentConnectors: {},
      connectors: [
        httpConnector('tailnet', 'https://nas.tail1234.ts.net/mcp', { connectVia: 'device' }),
        httpConnector('lan', 'http://192.168.1.5/mcp'),
        httpConnector('public', 'https://mcp.example.com/mcp'),
      ],
      installedPlugins: [
        ...(state.installedPlugins as object[]),
        {
          customParams: {
            mcp: { connectVia: 'device', type: 'http', url: 'https://nas.tail1234.ts.net/mcp' },
          },
          identifier: 'tailnet-plugin',
          manifest: { mcpAppEntrypoints: [open] },
        },
      ],
    } as unknown as ToolStore;
    const offered = () =>
      selectMcpAppEntrypoints(deviceRouted, true).map((item) => item.identifier);

    expect(offered()).toEqual(['notes', 'public']);

    // Self-hosted without a gateway, the server connects to them itself
    env.gateway = false;
    expect(offered()).toEqual(['notes', 'tailnet-plugin', 'tailnet', 'lan', 'public']);

    env.gateway = true;
    env.desktop = true;
    expect(offered()).toEqual(['notes', 'tailnet-plugin', 'tailnet', 'lan', 'public']);
  });
});
