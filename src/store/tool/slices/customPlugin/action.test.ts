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
      act(() => {
        useToolStore.setState({ createConnector, deleteConnector, syncConnectorTools });
      });
      return { createConnector, deleteConnector, syncConnectorTools };
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
        metadata: { avatar: 'icon', customHeaders: { 'X-Key': 'k' }, description: 'desc' },
        name: 'My MCP',
        sourceType: 'custom',
      });
      expect(syncConnectorTools).toHaveBeenCalledWith('conn-1');
      expect(deleteConnector).not.toHaveBeenCalled();
      expect(pluginService.updatePlugin).not.toHaveBeenCalled();
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
