import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pluginService } from '@/services/plugin';
import { type LobeToolCustomPlugin } from '@/types/tool/plugin';

import { useToolStore } from '../../store';
import { defaultCustomPlugin } from './initialState';

beforeEach(() => {
  vi.resetAllMocks();
});
vi.mock('@/services/plugin', () => ({
  pluginService: {
    updatePlugin: vi.fn(),
    createCustomPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    updatePluginManifest: vi.fn(),
  },
}));

vi.mock('@/services/tool', () => ({
  toolService: {
    getToolManifest: vi.fn(),
  },
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

  describe('saveToCustomPluginList', () => {
    it('should add a plugin to the custom plugin list and reset newCustomPlugin', async () => {
      const newPlugin = {
        type: 'customPlugin',
        manifest: {
          identifier: 'plugin2',
          meta: { title: 'New Plugin' },
        },
      } as LobeToolCustomPlugin;
      act(() => {
        useToolStore.setState({
          installedPlugins: [],
          newCustomPlugin: newPlugin,
        });
      });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.installCustomPlugin(newPlugin);
      });

      expect(result.current.newCustomPlugin).toEqual(defaultCustomPlugin);
      expect(pluginService.createCustomPlugin).toBeCalledWith(newPlugin);
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
