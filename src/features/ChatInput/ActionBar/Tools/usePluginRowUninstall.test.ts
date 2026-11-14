import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useToolStore } from '@/store/tool';

import { usePluginRowUninstall } from './usePluginRowUninstall';

const uninstallCustomPlugin = vi.fn();
const uninstallMCPPlugin = vi.fn();

const uninstallRow = (row: { identifier: string; runtimeType?: string; type: string }) =>
  renderHook(() => usePluginRowUninstall()).result.current(row);

describe('usePluginRowUninstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolStore.setState({ uninstallCustomPlugin, uninstallMCPPlugin } as never);
  });

  // A reinstalled marketplace MCP keeps its legacy row beside the connector it
  // runs on; the picker lists only the row, so its Delete must remove both.
  it('uninstalls a community MCP row through the marketplace uninstall', async () => {
    await uninstallRow({ identifier: 'market-mcp', runtimeType: 'mcp', type: 'plugin' });

    expect(uninstallMCPPlugin).toHaveBeenCalledWith('market-mcp');
    expect(uninstallCustomPlugin).not.toHaveBeenCalled();
  });

  it('removes only the plugin row of a custom MCP or a non-MCP community plugin', async () => {
    await uninstallRow({ identifier: 'my-mcp', runtimeType: 'mcp', type: 'customPlugin' });
    await uninstallRow({ identifier: 'search', runtimeType: 'default', type: 'plugin' });

    expect(uninstallCustomPlugin.mock.calls).toEqual([['my-mcp'], ['search']]);
    expect(uninstallMCPPlugin).not.toHaveBeenCalled();
  });
});
