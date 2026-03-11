import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notification } from '@/components/AntdStaticMethods';
import { pluginService } from '@/services/plugin';
import { toolService } from '@/services/tool';
import { type DiscoverPluginItem } from '@/types/discover';

import { useToolStore } from '../../store';

// Mock necessary modules and functions
vi.mock('@/components/AntdStaticMethods', () => ({
  notification: {
    error: vi.fn(),
  },
}));
// Mock the pluginService.getToolList method
vi.mock('@/services/plugin', () => ({
  pluginService: {
    uninstallPlugin: vi.fn(),
    installPlugin: vi.fn(),
  },
}));

vi.mock('@/services/tool', () => ({
  toolService: {
    getToolManifest: vi.fn(),
    getToolList: vi.fn(),
    getOldPluginList: vi.fn(),
  },
}));

// Mock i18next
vi.mock('i18next', () => ({
  t: vi.fn((key) => key),
}));

const pluginManifestMock = {
  $schema: '../node_modules/@lobehub/chat-plugin-sdk/schema.json',
  api: [
    {
      url: 'https://realtime-weather.chat-plugin.lobehub.com/api/v1',
      name: 'fetchCurrentWeather',
      description: '获取当前天气情况',
      parameters: {
        properties: {
          city: {
            description: '城市名称',
            type: 'string',
          },
        },
        required: ['city'],
        type: 'object',
      },
    },
  ],
  author: 'LobeHub',
  createAt: '2023-08-12',
  homepage: 'https://github.com/lobehub/chat-plugin-realtime-weather',
  identifier: 'realtime-weather',
  meta: {
    avatar: '🌈',
    tags: ['weather', 'realtime'],
    title: 'Realtime Weather',
    description: 'Get realtime weather information',
  },
  ui: {
    url: 'https://realtime-weather.chat-plugin.lobehub.com/iframe',
    height: 310,
  },
  version: '1',
};

const logError = console.error;
beforeEach(() => {
  vi.restoreAllMocks();
  useToolStore.setState({
    oldPluginItems: [
      {
        identifier: 'plugin1',
        title: 'plugin1',
        avatar: '🍏',
        manifest: 'https://abc.com/manifest.json',
      } as DiscoverPluginItem,
    ],
  });
  console.error = () => {};
});
afterEach(() => {
  console.error = logError;
});

describe('useToolStore:pluginStore', () => {
  describe('loadPluginStore', () => {
    it('should load plugin list and update state', async () => {
      // Given
      const pluginListMock = [{ identifier: 'plugin1' }, { identifier: 'plugin2' }];
      (toolService.getOldPluginList as Mock).mockResolvedValue({ items: pluginListMock });

      // When
      let pluginList;
      await act(async () => {
        pluginList = await useToolStore.getState().loadPluginStore();
      });

      // Then
      expect(toolService.getOldPluginList).toHaveBeenCalled();
      expect(pluginList).toEqual(pluginListMock);
      expect(useToolStore.getState().oldPluginItems).toEqual(pluginListMock);
    });

    it('should handle errors when loading plugin list', async () => {
      // Given
      const error = new Error('Failed to load plugin list');
      (toolService.getOldPluginList as Mock).mockRejectedValue(error);

      // When
      let pluginList;
      let errorOccurred = false;
      try {
        await act(async () => {
          pluginList = await useToolStore.getState().loadPluginStore();
        });
      } catch (e) {
        errorOccurred = true;
      }

      // Then
      expect(toolService.getOldPluginList).toHaveBeenCalled();
      expect(errorOccurred).toBe(true);
      expect(pluginList).toBeUndefined();
      // Ensure the state is not updated with an undefined value
      expect(useToolStore.getState().oldPluginItems).not.toBeUndefined();
    });
  });

  describe('useFetchPluginStore', () => {
    it('should fetch plugin store data', async () => {
      // Given
      const pluginListMock = [{ identifier: 'plugin1' }, { identifier: 'plugin2' }];
      (toolService.getOldPluginList as Mock).mockResolvedValue({ items: pluginListMock });

      // When
      const { result } = renderHook(() => useToolStore().useFetchPluginStore());

      // Wait for SWR to fetch data
      await waitFor(() => {
        expect(result.current.data).toEqual(pluginListMock);
      });

      // Then
      expect(toolService.getOldPluginList).toHaveBeenCalled();
      expect(result.current.error).toBeUndefined();
    });

    // Note: Error handling test is not included because SWR retries by default,
    // making error scenarios difficult to test in unit tests.
    // The underlying loadPluginStore error handling is tested separately above.
  });

  describe('installPlugin', () => {
    it('should be deprecated and do nothing', async () => {
      // Old plugin system has been deprecated
      await act(async () => {
        await useToolStore.getState().installPlugin('plugin1');
      });

      // Should not call any service
      expect(toolService.getToolManifest).not.toHaveBeenCalled();
      expect(pluginService.installPlugin).not.toHaveBeenCalled();
      expect(notification.error).not.toHaveBeenCalled();
    });
  });

  describe('installPlugins', () => {
    it('should be deprecated and do nothing', async () => {
      // Old plugin system has been deprecated
      await act(async () => {
        await useToolStore.getState().installPlugins(['plugin1', 'plugin2']);
      });

      // Should not call any service
      expect(pluginService.installPlugin).not.toHaveBeenCalled();
    });
  });

  describe('unInstallPlugin', () => {
    it('should uninstall a plugin and remove its manifest', async () => {
      // Given
      const pluginIdentifier = 'plugin1';
      act(() => {
        useToolStore.setState({
          installedPlugins: [
            {
              identifier: pluginIdentifier,
              type: 'plugin',
              manifest: {
                identifier: pluginIdentifier,
              } as LobeChatPluginManifest,
            },
          ],
        });
      });

      // When
      act(() => {
        useToolStore.getState().uninstallPlugin(pluginIdentifier);
      });

      // Then
      expect(pluginService.uninstallPlugin).toBeCalledWith(pluginIdentifier);
    });
  });

  describe('updateInstallLoadingState', () => {
    it('should update the loading state for a plugin', () => {
      const pluginIdentifier = 'abc';
      const loadingState = true;
      const { result } = renderHook(() => useToolStore());

      act(() => {
        result.current.updateInstallLoadingState(pluginIdentifier, loadingState);
      });

      expect(result.current.pluginInstallLoading[pluginIdentifier]).toBe(loadingState);
    });

    it('should clear the loading state for a plugin', () => {
      // Given
      const pluginIdentifier = 'dddd';
      const loadingState = undefined;

      act(() => {
        useToolStore.setState({ pluginInstallLoading: { [pluginIdentifier]: true } });
      });
      const { result } = renderHook(() => useToolStore());

      // When
      act(() => {
        result.current.updateInstallLoadingState(pluginIdentifier, loadingState);
      });

      // Then
      expect(result.current.pluginInstallLoading[pluginIdentifier]).toBe(loadingState);
    });
  });
});
