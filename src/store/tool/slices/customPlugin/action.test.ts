import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { type LobeToolCustomPlugin } from '@/types/tool/plugin';

import { useToolStore } from '../../store';

beforeEach(() => {
  vi.resetAllMocks();
});
vi.mock('@/services/plugin', () => ({
  pluginService: {
    updatePlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    updatePluginManifest: vi.fn(),
    getInstalledPlugins: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/services/mcp', () => ({
  mcpService: {
    getStreamableMcpServerManifest: vi.fn(),
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
      expect(pluginService.updatePlugin).not.toHaveBeenCalled();
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

  describe('updateCustomPlugin', () => {
    it('should update a specific plugin in the custom plugin list and reinstall the plugin', async () => {
      const pluginId = 'test-plugin';
      const old = {
        type: 'customPlugin',
        identifier: pluginId,
        manifest: {
          identifier: pluginId,
          meta: { title: 'Old Plugin', avatar: '🍎' },
        },
      } as LobeToolCustomPlugin;

      act(() => {
        useToolStore.setState({
          installedPlugins: [old],
        });
      });

      const { result } = renderHook(() => useToolStore());

      const updatedPlugin = {
        type: 'customPlugin',
        manifest: {
          identifier: pluginId,
          meta: { title: 'Updated Plugin', avatar: '🥒' },
        },
        identifier: pluginId,
      } as LobeToolCustomPlugin;

      await act(async () => {
        await result.current.updateCustomPlugin(pluginId, updatedPlugin);
      });

      expect(pluginService.updatePlugin).toHaveBeenCalledWith(pluginId, updatedPlugin);
    });

    // The loaded row still points at the old server until the list refreshes
    it('lists the tools of the server the edit saved, not the one the row had', async () => {
      const pluginId = 'moved-mcp';
      act(() => {
        useToolStore.setState({
          installedPlugins: [
            {
              customParams: {
                mcp: { headers: { 'x-env': 'a' }, url: 'https://a.example.com/mcp' },
              },
              identifier: pluginId,
              type: 'customPlugin',
            } as LobeToolCustomPlugin,
          ],
        });
      });
      vi.mocked(mcpService.getStreamableMcpServerManifest).mockResolvedValueOnce({} as never);
      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.updateCustomPlugin(pluginId, {
          customParams: {
            mcp: {
              auth: { token: 'b-token', type: 'bearer' },
              headers: { 'x-env': 'b' },
              url: 'https://b.example.com/mcp',
            },
          },
          identifier: pluginId,
          type: 'customPlugin',
        } as LobeToolCustomPlugin);
      });

      expect(mcpService.getStreamableMcpServerManifest).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { token: 'b-token', type: 'bearer' },
          headers: { 'x-env': 'b' },
          url: 'https://b.example.com/mcp',
        }),
      );
    });
  });

  describe('reinstallCustomPlugin', () => {
    it('retains the connection failure on the plugin row', async () => {
      const pluginId = 'broken-plugin';
      vi.mocked(mcpService.getStreamableMcpServerManifest).mockRejectedValueOnce({
        cause: 'Connection refused',
        message: 'connectionError',
      });

      act(() => {
        useToolStore.setState({
          installedPlugins: [
            {
              customParams: { mcp: { url: 'https://mcp.example.com' } },
              identifier: pluginId,
              type: 'customPlugin',
            } as LobeToolCustomPlugin,
          ],
          pluginInstallErrors: {},
        });
      });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.reinstallCustomPlugin(pluginId);
      });

      expect(result.current.pluginInstallErrors[pluginId]).toEqual({
        cause: 'Connection refused',
        message: 'connectionError',
      });
      expect(result.current.pluginInstallLoading[pluginId]).toBe(false);
    });
  });

  describe('updateNewCustomPlugin', () => {
    it('should update the newCustomPlugin state with the provided values', () => {
      const initialNewCustomPlugin = {
        type: 'customPlugin',
        manifest: {
          identifier: 'plugin3',
          meta: { title: 'Initial Plugin' },
        },
      } as LobeToolCustomPlugin;
      const updates = { meta: { title: 'Updated Name' } } as Partial<LobeToolCustomPlugin>;
      const expectedNewCustomPlugin = { ...initialNewCustomPlugin, ...updates };

      act(() => {
        useToolStore.setState({
          newCustomPlugin: initialNewCustomPlugin,
        });
      });

      const { result } = renderHook(() => useToolStore());

      act(() => {
        result.current.updateNewCustomPlugin(updates);
      });

      expect(useToolStore.getState().newCustomPlugin).toEqual(expectedNewCustomPlugin);
    });
  });
});
