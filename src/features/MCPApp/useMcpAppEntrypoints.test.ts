import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState, useMcpAppStore } from '@/store/mcpApp/store';

import { useMcpAppEntrypoints } from './useMcpAppEntrypoints';

const mocks = vi.hoisted(() => ({
  confirmed: true,
  enabled: false,
  state: {
    installedPlugins: [] as any[],
    connectors: [] as any[],
    agentConnectors: {},
    ensureConfirmedConnectors: vi.fn().mockResolvedValue(undefined),
    refreshPlugins: vi.fn().mockResolvedValue(undefined),
    syncConnectorTools: vi.fn().mockResolvedValue(undefined),
  },
  discover: vi.fn().mockResolvedValue({ api: [], mcpAppEntrypoints: [] }),
  save: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({}),
  serverConfigSelectors: { enableMcpApps: () => mocks.enabled },
  useServerConfigStore: () => mocks.enabled,
}));
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: any) => selector(mocks.state),
  getToolStoreState: () => mocks.state,
}));
vi.mock('@/store/agent', () => ({ useAgentStore: (selector: any) => selector({}) }));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { getAgentConfigById: () => () => ({ plugins: [] }) },
}));
vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: { isInstalledPluginsServerConfirmed: () => mocks.confirmed },
}));
vi.mock('@/services/mcp', () => ({
  mcpService: { getPluginMcpManifest: mocks.discover },
}));
vi.mock('@/services/plugin', () => ({ pluginService: { updatePluginManifest: mocks.save } }));
beforeEach(() => {
  useMcpAppStore.setState(initialState);
  vi.clearAllMocks();
  mocks.confirmed = true;
  mocks.enabled = false;
  mocks.state.installedPlugins = [];
  mocks.state.connectors = [];
});

describe('gated entrypoint discovery refresh', () => {
  it('does not inspect app metadata or perform a refresh with the flag off', () => {
    mocks.state.installedPlugins = [
      {
        identifier: 'notes',
        get manifest() {
          throw new Error('must not inspect');
        },
      },
    ];
    const { result } = renderHook(() => useMcpAppEntrypoints('agent'));
    expect(result.current).toEqual([]);
    expect(mocks.state.ensureConfirmedConnectors).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.state.syncConnectorTools).not.toHaveBeenCalled();
  });
  it('refreshes an old plugin manifest once and keeps refreshed manifests intact', async () => {
    mocks.enabled = true;
    mocks.state.installedPlugins = [
      {
        identifier: 'notes',
        customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
        manifest: { api: [] },
        settings: { API_KEY: 'secret' },
      },
    ];
    const { rerender, unmount } = renderHook(() => useMcpAppEntrypoints());
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    // Read as the plugin's tool calls are: with its settings (credentials)
    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'notes', settings: { API_KEY: 'secret' } }),
    );
    mocks.state.installedPlugins = [...mocks.state.installedPlugins];
    rerender();
    expect(mocks.discover).toHaveBeenCalledOnce();
    expect(mocks.state.refreshPlugins).toHaveBeenCalledOnce();
    unmount();
    renderHook(() => useMcpAppEntrypoints());
    expect(mocks.discover).toHaveBeenCalledOnce();
  });
  it("waits for the server's plugin records before spending a plugin's discovery", async () => {
    mocks.enabled = true;
    mocks.confirmed = false;
    // Painted from the local cache: the projection keeps the type, not the URL
    mocks.state.installedPlugins = [
      { customParams: { mcp: { type: 'http' } }, identifier: 'notes', manifest: { api: [] } },
    ];
    const { rerender } = renderHook(() => useMcpAppEntrypoints());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.discover).not.toHaveBeenCalled();

    mocks.confirmed = true;
    mocks.state.installedPlugins = [
      {
        customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
        identifier: 'notes',
        manifest: { api: [] },
      },
    ];
    rerender();

    await waitFor(() => expect(mocks.discover).toHaveBeenCalledOnce());
    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
      }),
    );
  });
});
