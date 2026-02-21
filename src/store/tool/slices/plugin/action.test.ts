import { type LobeTool } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pluginService } from '@/services/plugin';
import { type DiscoverPluginItem } from '@/types/discover';
import { merge } from '@/utils/merge';

import { useToolStore } from '../../store';

vi.mock('@/services/plugin', () => ({
  pluginService: {
    updatePluginSettings: vi.fn(),
    removeAllPlugins: vi.fn(),
  },
}));

beforeEach(() => {
  // Reset all mocks before each test
  vi.resetAllMocks();
});

describe('useToolStore:plugin', () => {
  describe('checkPluginsIsInstalled', () => {
    it('should not perform any operations if the plugin list is empty', async () => {
      const installPluginsMock = vi.fn();
      useToolStore.setState({
        loadPluginStore: vi.fn(),
        installPlugins: installPluginsMock,
      });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.checkPluginsIsInstalled([]);
      });

      expect(installPluginsMock).not.toHaveBeenCalled();
    });

    it('should load the plugin store and install plugins if necessary', async () => {
      const plugins = ['plugin1', 'plugin2'];
      const loadPluginStoreMock = vi.fn();
      const installPluginsMock = vi.fn();
      useToolStore.setState({
        loadPluginStore: loadPluginStoreMock,
        installPlugins: installPluginsMock,
      });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.checkPluginsIsInstalled(plugins);
      });

      expect(loadPluginStoreMock).toHaveBeenCalled();
      expect(installPluginsMock).toHaveBeenCalledWith(plugins);
    });

    it('should not load the plugin store and install plugins', async () => {
      const plugins = ['plugin1', 'plugin2'];
      const loadPluginStoreMock = vi.fn();
      const installPluginsMock = vi.fn();
      useToolStore.setState({
        loadPluginStore: loadPluginStoreMock,
        installPlugins: installPluginsMock,
        installedPlugins: [{ identifier: 'abc' }] as LobeTool[],
        oldPluginItems: [{ identifier: 'abc' }] as DiscoverPluginItem[],
      });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.checkPluginsIsInstalled(plugins);
      });

      expect(loadPluginStoreMock).not.toHaveBeenCalled();
      expect(installPluginsMock).toHaveBeenCalledWith(plugins);
    });
  });

  describe('updatePluginSettings', () => {
    it('should update settings for a given plugin', async () => {
      const pluginId = 'test-plugin';
      const newSettings = { setting1: 'new-value' };

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.updatePluginSettings(pluginId, newSettings);
      });

      expect(pluginService.updatePluginSettings).toBeCalledWith(
        pluginId,
        newSettings,
        expect.any(AbortSignal),
      );
    });

    it('should merge settings for a plugin with existing settings', async () => {
      const pluginId = 'test-plugin';
      const existingSettings = { setting1: 'old-value', setting2: 'old-value' };
      const newSettings = { setting1: 'new-value' };
      const mergedSettings = merge(existingSettings, newSettings);
      useToolStore.setState({
        installedPlugins: [{ identifier: pluginId, settings: existingSettings }] as LobeTool[],
      });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.updatePluginSettings(pluginId, newSettings);
      });

      expect(pluginService.updatePluginSettings).toBeCalledWith(
        pluginId,
        mergedSettings,
        expect.any(AbortSignal),
      );
    });
  });

  describe('removeAllPlugins', () => {
    it('should reset all plugin settings', () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        result.current.removeAllPlugins();
      });

      expect(pluginService.removeAllPlugins).toBeCalled();
    });
  });

  describe('validatePluginSettings', () => {
    // 模拟插件数据
    const testPluginId = 'test-plugin';
    // 定义测试用的 schema 和模拟的验证结果
    const testSchema = {
      properties: { abc: { type: 'string' } },
      required: ['abc'],
      type: 'object',
    };

    const testPluginSettings = { abc: 'valid-string' };

    const testPlugin = {
      type: 'plugin',
      identifier: testPluginId,
      manifest: {
        identifier: testPluginId,
        settings: testSchema,
      },
      settings: testPluginSettings,
    } as unknown as LobeTool;

    it('should validate settings against the schema and return valid result', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          installedPlugins: [testPlugin],
        });
      });

      const validationResult = await result.current.validatePluginSettings(testPluginId);

      expect(validationResult).toEqual({ valid: true, errors: [] });
    });

    it('should return invalid result if settings do not match the schema', async () => {
      const { result } = renderHook(() => useToolStore());
      act(() => {
        useToolStore.setState({
          installedPlugins: [{ ...testPlugin, settings: {} }] as any,
        });
      });

      const validationResult = await result.current.validatePluginSettings(testPluginId);

      expect(validationResult).toMatchSnapshot();
    });

    it('should return undefined if manifest or settings are not found', async () => {
      useToolStore.setState({
        installedPlugins: [],
      });

      const { result } = renderHook(() => useToolStore());

      const validationResult = await result.current.validatePluginSettings(testPluginId);

      expect(validationResult).toBeUndefined();
    });
  });
});
