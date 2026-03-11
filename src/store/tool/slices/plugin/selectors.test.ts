import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { describe, expect, it } from 'vitest';

import { type DiscoverPluginItem } from '@/types/discover';

import { type ToolStoreState } from '../../initialState';
import { initialState } from '../../initialState';
import { pluginSelectors } from './selectors';

const mockState = {
  ...initialState,
  pluginInstallLoading: {
    'plugin-1': false,
    'plugin-2': true,
  },
  installedPlugins: [
    {
      identifier: 'plugin-1',
      type: 'plugin',
      manifest: {
        identifier: 'plugin-1',
        api: [{ name: 'api-1' }],
        type: 'default',
      } as LobeChatPluginManifest,
      settings: { setting1: 'value1' },
    },
    {
      identifier: 'plugin-2',
      manifest: {
        identifier: 'plugin-2',
        api: [{ name: 'api-2' }],
      },
      type: 'plugin',
    },
    {
      identifier: 'plugin-3',
      manifest: {
        identifier: 'plugin-3',
        api: [{ name: 'api-3' }],
      },
      type: 'customPlugin',
    },
  ],
  oldPluginItems: [
    {
      identifier: 'plugin-1',
      author: 'Author 1',
      createdAt: '2021-01-01',
      avatar: 'avatar-url-1',
      title: 'Plugin 1',
      homepage: 'http://homepage-1.com',
    } as DiscoverPluginItem,
    {
      identifier: 'plugin-2',
      author: 'Author 2',
      createdAt: '2022-02-02',
      meta: { avatar: 'avatar-url-2', title: 'Plugin 2' },
      homepage: 'http://homepage-2.com',
    },
  ],
} as ToolStoreState;

describe('pluginSelectors', () => {
  describe('getToolManifestById', () => {
    it('getToolManifestById should return the correct manifest', () => {
      const result = pluginSelectors.getToolManifestById('plugin-1')(mockState);
      expect(result).toEqual(mockState.installedPlugins[0].manifest);
    });
  });

  describe('getPluginMetaById', () => {
    it('should return the plugin metadata by id', () => {
      const result = pluginSelectors.getPluginMetaById('plugin-1')(mockState);
      const item = mockState.oldPluginItems[0];
      expect(result).toEqual({
        title: item.title,
        avatar: item.avatar,
      });
    });
  });

  describe('getDevPluginById', () => {
    it('should return undefined for non-existing custom plugin', () => {
      const result = pluginSelectors.getCustomPluginById('non-existing')(mockState);
      expect(result).toBeUndefined();
    });

    it('should return custom plugin by id if exists', () => {
      const customPlugin = {
        type: 'customPlugin',
        identifier: 'custom-plugin',
        manifest: {
          identifier: 'custom-plugin',
          author: 'Custom Author',
          createAt: '2023-03-03',
          meta: { avatar: 'avatar-url-custom', title: 'Custom Plugin' },
          homepage: 'http://homepage-custom.com',
        },
      };

      const stateWithCustomPlugin = {
        ...mockState,
        installedPlugins: [...mockState.installedPlugins, customPlugin],
      } as ToolStoreState;
      const result = pluginSelectors.getCustomPluginById('custom-plugin')(stateWithCustomPlugin);
      expect(result).toEqual(customPlugin);
    });
  });

  describe('getPluginSettingsById', () => {
    it('should return the plugin settings by id', () => {
      const mockSettings = { setting1: 'value1' };

      const result = pluginSelectors.getPluginSettingsById('plugin-1')(mockState);
      expect(result).toEqual(mockSettings);
    });
  });

  describe('hasPluginUI', () => {
    it('should return false when the plugin does not have a UI component', () => {
      const result = pluginSelectors.isPluginHasUI('non-ui-plugin')(mockState);
      expect(result).toBe(false);
    });

    it('should return true when the plugin has a UI component', () => {
      const stateWithUIPlugin = {
        ...mockState,
        installedPlugins: [
          ...mockState.installedPlugins,
          {
            ...mockState.installedPlugins[0],
            identifier: 'ui-plugin',
            manifest: {
              ...mockState.installedPlugins[0].manifest,
              identifier: 'ui-plugin',
              ui: true,
            },
          },
        ],
      } as ToolStoreState;
      const result = pluginSelectors.isPluginHasUI('ui-plugin')(stateWithUIPlugin);
      expect(result).toBe(true);
    });
  });

  describe('isPluginInstalled', () => {
    it('should return true if the plugin is installed', () => {
      const result = pluginSelectors.isPluginInstalled('plugin-1')(mockState);
      expect(result).toBe(true);
    });

    it('should return false if the plugin is not installed', () => {
      const result = pluginSelectors.isPluginInstalled('non-installed-plugin')(mockState);
      expect(result).toBe(false);
    });
  });

  describe('getInstalledPluginById', () => {
    it('should return the installed plugin by id', () => {
      const result = pluginSelectors.getInstalledPluginById('plugin-1')(mockState);
      expect(result).toEqual(mockState.installedPlugins[0]);
    });

    it('should return undefined if the plugin is not installed', () => {
      const result = pluginSelectors.getInstalledPluginById('non-installed-plugin')(mockState);
      expect(result).toBeUndefined();
    });
  });

  describe('storeAndInstallPluginsIdList', () => {
    it('should return a list of unique plugin identifiers from both installed and store lists', () => {
      const result = pluginSelectors.storeAndInstallPluginsIdList(mockState);
      expect(result).toEqual(['plugin-1', 'plugin-2', 'plugin-3']);
    });
  });

  describe('installedPluginManifestList', () => {
    it('should return a list of manifests for installed plugins', () => {
      const result = pluginSelectors.installedPluginManifestList(mockState);
      const expectedManifests = mockState.installedPlugins.map((p) => p.manifest);
      expect(result).toEqual(expectedManifests);
    });
  });

  describe('installedPluginMetaList', () => {
    it('should return a list of meta information for installed plugins', () => {
      const result = pluginSelectors.installedPluginMetaList(mockState);
      const expectedMetaList = mockState.installedPlugins.map((p) => ({
        identifier: p.identifier,
        meta: pluginSelectors.getPluginMetaById(p.identifier)(mockState),
        type: p.type,
        ...pluginSelectors.getPluginMetaById(p.identifier)(mockState),
      }));
      expect(result).toEqual(expectedMetaList);
    });
  });

  describe('installedCustomPluginMetaList', () => {
    it('should return a list of meta information for installed plugins', () => {
      const result = pluginSelectors.installedCustomPluginMetaList(mockState);

      expect(result).toEqual([{ identifier: 'plugin-3', type: 'customPlugin' }]);
    });
  });
});
