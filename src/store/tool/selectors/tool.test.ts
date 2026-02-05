import type { LobeChatPluginManifest} from '@lobehub/chat-plugin-sdk';
import { describe, expect, it } from 'vitest';

import type { ToolStoreState  } from '../initialState';
import { initialState  } from '../initialState';
import { toolSelectors } from './tool';

const mockState = {
  ...initialState,
  installedPlugins: [
    {
      identifier: 'plugin-1',
      manifest: {
        identifier: 'plugin-1',
        api: [{ name: 'api-1' }],
        meta: { title: 'Plugin 1', description: 'Plugin 1 description' },
      } as LobeChatPluginManifest,
      type: 'plugin',
    },
    {
      identifier: 'plugin-2',
      manifest: {
        identifier: 'plugin-2',
        api: [{ name: 'api-2' }],
      } as LobeChatPluginManifest,
      type: 'plugin',
    },
    {
      identifier: 'plugin-3',
      manifest: {
        identifier: 'plugin-3',
        api: [
          {
            name: 'api-3',
            url: 'bac',
            description: '123123',
            parameters: { type: 'object', properties: { a: { type: 'string' } } },
          },
        ],
      },
      type: 'customPlugin',
    },
  ],
  builtinTools: [
    {
      type: 'builtin',
      identifier: 'builtin-1',
      manifest: {
        identifier: 'builtin-1',
        api: [{ name: 'builtin-api-1' }],
        meta: { title: 'Builtin 1', description: 'Builtin 1 description' },
      } as LobeChatPluginManifest,
    },
  ],
  pluginInstallLoading: {
    'plugin-1': false,
    'plugin-2': true,
  },
} as ToolStoreState;

describe('toolSelectors', () => {
  describe('getToolManifestLoadingStatus', () => {
    it('should return "loading" if the plugin manifest is being loaded', () => {
      const result = toolSelectors.getManifestLoadingStatus('plugin-2')(mockState);
      expect(result).toBe('loading');
    });

    it('should return "error" if the plugin manifest is not found', () => {
      const result = toolSelectors.getManifestLoadingStatus('non-existing-plugin')(mockState);
      expect(result).toBe('error');
    });

    it('should return "success" if the plugin manifest is loaded', () => {
      const result = toolSelectors.getManifestLoadingStatus('plugin-1')(mockState);
      expect(result).toBe('success');
    });
  });

  describe('metaList and getMetaById', () => {
    it('should return the correct list of tool metadata', () => {
      const result = toolSelectors.metaList(mockState);
      expect(result).toEqual([
        {
          type: 'builtin',
          author: 'LobeHub',
          identifier: 'builtin-1',
          meta: { title: 'Builtin 1', description: 'Builtin 1 description' },
        },
        {
          identifier: 'plugin-1',
          type: 'plugin',
          meta: { title: 'Plugin 1', description: 'Plugin 1 description' },
          title: 'Plugin 1',
          description: 'Plugin 1 description',
        },
        {
          type: 'plugin',
          identifier: 'plugin-2',
          meta: undefined,
        },
        {
          identifier: 'plugin-3',
          type: 'customPlugin',
        },
      ]);
    });

    it('should return the correct metadata by identifier', () => {
      const result = toolSelectors.getMetaById('plugin-1')(mockState);
      expect(result).toEqual({ title: 'Plugin 1', description: 'Plugin 1 description' });
    });

    it('should return undefined for non-existent identifier', () => {
      const result = toolSelectors.getMetaById('non-existent')(mockState);
      expect(result).toBeUndefined();
    });
  });

  describe('getManifestById and getManifestLoadingStatus', () => {
    it('should return the correct manifest by identifier', () => {
      const result = toolSelectors.getManifestById('plugin-1')(mockState);
      expect(result).toEqual({
        identifier: 'plugin-1',
        api: [{ name: 'api-1' }],
        meta: { title: 'Plugin 1', description: 'Plugin 1 description' },
      });
    });

    it('should return undefined for non-existent identifier', () => {
      const result = toolSelectors.getManifestById('non-existent')(mockState);
      expect(result).toBeUndefined();
    });

    it('should return the correct loading status for a plugin', () => {
      expect(toolSelectors.getManifestLoadingStatus('plugin-1')(mockState)).toBe('success');
      expect(toolSelectors.getManifestLoadingStatus('plugin-2')(mockState)).toBe('loading');
      expect(toolSelectors.getManifestLoadingStatus('non-existent')(mockState)).toBe('error');
    });
  });

  describe('isToolHasUI', () => {
    it('should return false if the tool has no UI', () => {
      expect(toolSelectors.isToolHasUI('plugin-1')(mockState)).toBe(false);
    });

    it('should return true if the tool has UI', () => {
      expect(toolSelectors.isToolHasUI('builtin-1')(mockState)).toBe(true);
    });

    it('should return false if the tool does not exist', () => {
      expect(toolSelectors.isToolHasUI('non-existent')(mockState)).toBe(false);
    });
  });
});
