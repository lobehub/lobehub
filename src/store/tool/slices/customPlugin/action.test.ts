import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pluginService } from '@/services/plugin';
import { type LobeToolCustomPlugin } from '@/types/tool/plugin';

import { useToolStore } from '../../store';

beforeEach(() => {
  vi.resetAllMocks();
});
vi.mock('@/services/plugin', () => ({
  pluginService: {
    uninstallPlugin: vi.fn(),
    getInstalledPlugins: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('i18next', () => ({
  t: (_key: string, options?: { error?: string }) => options?.error || 'Plugin refresh failed',
}));

describe('useToolStore:customPlugin', () => {
  describe('deleteCustomPlugin', () => {
    it('should delete custom plugin and related settings', async () => {
      // 设置初始状态和 mock 函数

      act(() => {
        useToolStore.setState({
          // ...其他状态
          installedPlugins: [{ identifier: 'test-plugin' } as LobeToolCustomPlugin],
        });
      });

      const { result } = renderHook(() => useToolStore());
      const pluginId = 'test-plugin';

      act(() => {
        result.current.uninstallCustomPlugin(pluginId);
      });

      expect(pluginService.uninstallPlugin).toBeCalledWith(pluginId);
    });
  });

  describe('installCustomMcpConnector', () => {
    const mockConnectorActions = () => {
      const createConnector = vi.fn().mockResolvedValue({ id: 'conn-1', isNew: true });
      const deleteConnector = vi.fn().mockResolvedValue(undefined);
      const syncConnectorTools = vi.fn().mockResolvedValue(undefined);
      const fetchConnectors = vi.fn().mockResolvedValue(undefined);
      const getConnectorForEdit = vi.fn();
      const updateConnector = vi.fn().mockResolvedValue(undefined);
      act(() => {
        useToolStore.setState({
          connectors: [],
          createConnector,
          deleteConnector,
          fetchConnectors,
          getConnectorForEdit,
          syncConnectorTools,
          updateConnector,
        });
      });
      return {
        createConnector,
        deleteConnector,
        getConnectorForEdit,
        syncConnectorTools,
        updateConnector,
      };
    };

    it('adds an http MCP as a custom connector and syncs its tools, writing no plugin row', async () => {
      const { createConnector, deleteConnector, syncConnectorTools } = mockConnectorActions();

      await act(async () => {
        await useToolStore.getState().installCustomMcpConnector({
          config: { headers: { 'X-Key': 'k' }, type: 'http', url: ' https://mcp.example.com ' },
          description: 'desc',
          icon: 'icon',
          identifier: 'my-mcp',
          name: 'My MCP',
        });
      });

      expect(createConnector).toHaveBeenCalledWith({
        identifier: 'my-mcp',
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.example.com',
        mcpStdioConfig: undefined,
        metadata: {
          avatar: 'icon',
          customHeaders: { 'X-Key': 'k' },
          description: 'desc',
          desktopStdioExecution: true,
        },
        name: 'My MCP',
        sourceType: 'custom',
      });
      // A reinstall's tool list replaces the stored one
      expect(syncConnectorTools).toHaveBeenCalledWith('conn-1', { pruneMissingAutoTools: true });
      expect(deleteConnector).not.toHaveBeenCalled();
      expect(pluginService.uninstallPlugin).not.toHaveBeenCalled();
    });

    // The lists would show the plugin in the connector's place, so their
    // Configure and Delete would act on a row the calls no longer run on. The
    // protocol-install popup mounts no plugin list, so the store may hold none.
    it('removes a legacy custom plugin of the same identifier once the connector is synced', async () => {
      const { syncConnectorTools } = mockConnectorActions();
      act(() => {
        useToolStore.setState({ installedPlugins: [] });
      });
      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
        { identifier: 'my-mcp', manifest: { identifier: 'my-mcp' }, type: 'customPlugin' },
      ] as never);

      await act(async () => {
        await useToolStore.getState().installCustomMcpConnector({
          config: { type: 'http', url: 'https://mcp.example.com' },
          identifier: 'my-mcp',
        });
      });

      expect(pluginService.uninstallPlugin).toHaveBeenCalledWith('my-mcp');
      expect(vi.mocked(pluginService.uninstallPlugin).mock.invocationCallOrder[0]).toBeGreaterThan(
        syncConnectorTools.mock.invocationCallOrder[0],
      );
    });

    it('keeps a same-identifier plugin the server does not list as a custom plugin', async () => {
      mockConnectorActions();
      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
        { identifier: 'my-mcp', manifest: { identifier: 'my-mcp' }, type: 'plugin' },
      ] as never);

      await act(async () => {
        await useToolStore.getState().installCustomMcpConnector({
          config: { type: 'http', url: 'https://mcp.example.com' },
          identifier: 'my-mcp',
        });
      });

      expect(pluginService.uninstallPlugin).not.toHaveBeenCalled();
    });

    it('keeps the legacy custom plugin when the connector sync fails', async () => {
      const { syncConnectorTools } = mockConnectorActions();
      syncConnectorTools.mockRejectedValue(new Error('unreachable'));
      act(() => {
        useToolStore.setState({
          installedPlugins: [
            { identifier: 'my-mcp', manifest: { identifier: 'my-mcp' }, type: 'customPlugin' },
          ] as never,
        });
      });

      await expect(
        useToolStore.getState().installCustomMcpConnector({
          config: { type: 'http', url: 'https://mcp.example.com' },
          identifier: 'my-mcp',
        }),
      ).rejects.toThrow('unreachable');
      expect(pluginService.uninstallPlugin).not.toHaveBeenCalled();
    });

    it('stores a stdio MCP command on the connector', async () => {
      const { createConnector } = mockConnectorActions();

      await act(async () => {
        await useToolStore.getState().installCustomMcpConnector({
          config: { args: ['-y', 'pkg'], command: 'npx', env: { A: '1' }, type: 'stdio' },
          identifier: 'local-mcp',
        });
      });

      expect(createConnector).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpConnectionType: 'stdio',
          mcpServerUrl: undefined,
          mcpStdioConfig: { args: ['-y', 'pkg'], command: 'npx', env: { A: '1' } },
          // Its calls stay on the desktop, as the custom plugin's did
          metadata: expect.objectContaining({ desktopStdioExecution: true }),
          name: 'local-mcp',
        }),
      );
    });

    it('removes the connector it created when the tool sync fails', async () => {
      const { deleteConnector, syncConnectorTools } = mockConnectorActions();
      syncConnectorTools.mockRejectedValue(new Error('unreachable'));

      await expect(
        useToolStore.getState().installCustomMcpConnector({
          config: { type: 'http', url: 'https://down.example.com' },
          identifier: 'down',
        }),
      ).rejects.toThrow('unreachable');
      expect(deleteConnector).toHaveBeenCalledWith('conn-1');
    });

    it('keeps a connector that already existed when the tool sync fails', async () => {
      const { createConnector, deleteConnector, syncConnectorTools } = mockConnectorActions();
      createConnector.mockResolvedValue({ id: 'conn-old', isNew: false });
      syncConnectorTools.mockRejectedValue(new Error('unreachable'));

      await expect(
        useToolStore.getState().installCustomMcpConnector({
          config: { type: 'http', url: 'https://down.example.com' },
          identifier: 'down',
        }),
      ).rejects.toThrow('unreachable');
      expect(deleteConnector).not.toHaveBeenCalled();
    });

    it('refuses to replace a marketplace connector with the same identifier', async () => {
      const { createConnector } = mockConnectorActions();
      act(() => {
        useToolStore.setState({
          connectors: [
            {
              id: 'market-1',
              identifier: 'shared',
              mcpConnectionType: 'http',
              mcpServerUrl: 'https://market.example.com',
              sourceType: 'marketplace',
            },
          ] as never,
        });
      });

      await expect(
        useToolStore.getState().installCustomMcpConnector({
          config: { type: 'http', url: 'https://mine.example.com' },
          identifier: 'shared',
        }),
      ).rejects.toThrow('already exists');
      expect(createConnector).not.toHaveBeenCalled();
    });

    it('restores the custom connector it reinstalled over when the tool sync fails', async () => {
      const {
        createConnector,
        deleteConnector,
        getConnectorForEdit,
        syncConnectorTools,
        updateConnector,
      } = mockConnectorActions();
      act(() => {
        useToolStore.setState({
          connectors: [
            {
              id: 'conn-old',
              identifier: 'down',
              mcpConnectionType: 'http',
              mcpServerUrl: 'https://old.example.com',
              sourceType: 'custom',
            },
          ] as never,
        });
      });
      getConnectorForEdit.mockResolvedValue({
        credentials: { token: 'old-token', type: 'bearer' },
        id: 'conn-old',
        isEnabled: true,
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://old.example.com',
        mcpStdioConfig: null,
        metadata: { description: 'old' },
        name: 'Old',
        oidcConfig: null,
        status: 'disconnected',
        tools: [],
      });
      createConnector.mockResolvedValue({ id: 'conn-old', isNew: false });
      syncConnectorTools.mockRejectedValue(new Error('unreachable'));

      await expect(
        useToolStore.getState().installCustomMcpConnector({
          config: { type: 'http', url: 'https://down.example.com' },
          identifier: 'down',
        }),
      ).rejects.toThrow('unreachable');
      expect(deleteConnector).not.toHaveBeenCalled();
      expect(updateConnector).toHaveBeenCalledWith(
        'conn-old',
        expect.objectContaining({
          credentials: { token: 'old-token', type: 'bearer' },
          mcpServerUrl: 'https://old.example.com',
          metadata: { description: 'old' },
          name: 'Old',
        }),
      );
    });
  });
});
