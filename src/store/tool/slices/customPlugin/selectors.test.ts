import { type LobeChatPluginManifest, type LobeChatPluginMeta } from '@lobehub/chat-plugin-sdk';
import { describe, expect, it } from 'vitest';

import { type ToolStoreState } from '../../initialState';
import { initialState } from '../../initialState';
import { customPluginSelectors } from './selectors';

const mockState = {
  ...initialState,
  pluginManifestLoading: {
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
    },
    {
      identifier: 'plugin-2',
      manifest: {
        identifier: 'plugin-2',
        api: [{ name: 'api-2' }],
        type: 'default',
      },
      type: 'plugin',
    },
  ],
  pluginStoreList: [
    {
      identifier: 'plugin-1',
      author: 'Author 1',
      createdAt: '2021-01-01',
      meta: { avatar: 'avatar-url-1', title: 'Plugin 1' },
      homepage: 'http://homepage-1.com',
    } as LobeChatPluginMeta,
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
  describe('isCustomPlugin', () => {
    it('should return false for a non-custom plugin', () => {
      const result = customPluginSelectors.isCustomPlugin('plugin-1')(mockState);
      expect(result).toBe(false);
    });

    it('should return true for a custom plugin', () => {
      const stateWithCustomPlugin = {
        ...mockState,
        installedPlugins: [
          ...mockState.installedPlugins,
          { identifier: 'custom-plugin', type: 'customPlugin' },
        ],
      } as ToolStoreState;
      const result = customPluginSelectors.isCustomPlugin('custom-plugin')(stateWithCustomPlugin);
      expect(result).toBe(true);
    });
  });
});
