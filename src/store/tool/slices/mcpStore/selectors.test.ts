import { type PluginItem } from '@lobehub/market-sdk';
import { describe, expect, it } from 'vitest';

import { MCPInstallStep } from '@/types/plugins';

import { initialState } from '../../initialState';
import { type ToolStoreState } from '../../initialState';
import { mcpStoreSelectors } from './selectors';

const createMockPluginItem = (id: string, overrides: Partial<PluginItem> = {}): PluginItem =>
  ({
    author: `Author of ${id}`,
    capabilities: [],
    category: 'general',
    commentCount: 0,
    connectionType: 'http',
    createdAt: '2024-01-01',
    description: `Description of ${id}`,
    github: '',
    haveCloudEndpoint: false,
    homepage: `https://example.com/${id}`,
    icon: `https://example.com/${id}/icon.png`,
    identifier: id,
    installCount: 0,
    isClaimed: false,
    isFeatured: false,
    isOfficial: false,
    isValidated: false,
    manifestUrl: `https://example.com/${id}/manifest`,
    name: `Plugin ${id}`,
    promptsCount: 0,
    ratingAverage: 0,
    ratingCount: 0,
    resourcesCount: 0,
    tags: ['tag1'],
    toolsCount: 0,
    updatedAt: '2024-01-01',
    ...overrides,
  }) as unknown as PluginItem;

const mockMcpPluginItems: PluginItem[] = [
  createMockPluginItem('plugin-a'),
  createMockPluginItem('plugin-b'),
  createMockPluginItem('plugin-c'),
];

const baseState: ToolStoreState = {
  ...initialState,
  mcpPluginItems: mockMcpPluginItems,
  installedPlugins: [
    {
      identifier: 'plugin-a',
      type: 'plugin',
      manifest: { identifier: 'plugin-a', api: [], type: 'default' } as any,
      settings: {},
    },
  ],
  listType: 'mcp',
};

describe('mcpStoreSelectors', () => {
  describe('mcpPluginList', () => {
    it('should return all mcp plugins when listType is MCP', () => {
      const state: ToolStoreState = { ...baseState, listType: 'mcp' };
      const result = mcpStoreSelectors.mcpPluginList(state);

      expect(result).toHaveLength(3);
    });

    it('should return only installed plugins when listType is Installed', () => {
      const state: ToolStoreState = { ...baseState, listType: 'installed' };
      const result = mcpStoreSelectors.mcpPluginList(state);

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('plugin-a');
    });

    it('should map plugin items to InstallPluginMeta format', () => {
      const state: ToolStoreState = { ...baseState, listType: 'mcp' };
      const result = mcpStoreSelectors.mcpPluginList(state);
      const item = result[0];

      expect(item).toMatchObject({
        author: 'Author of plugin-a',
        homepage: 'https://example.com/plugin-a',
        identifier: 'plugin-a',
        type: 'plugin',
        meta: {
          avatar: 'https://example.com/plugin-a/icon.png',
          description: 'Description of plugin-a',
          tags: ['tag1'],
          title: 'Plugin plugin-a',
        },
      });
    });

    it('should return empty array when no plugins are installed and listType is Installed', () => {
      const state: ToolStoreState = {
        ...baseState,
        installedPlugins: [],
        listType: 'installed',
      };
      const result = mcpStoreSelectors.mcpPluginList(state);

      expect(result).toHaveLength(0);
    });

    it('should return empty array when mcpPluginItems is empty', () => {
      const state: ToolStoreState = { ...baseState, mcpPluginItems: [] };
      const result = mcpStoreSelectors.mcpPluginList(state);

      expect(result).toHaveLength(0);
    });

    it('should filter correctly when multiple plugins are installed', () => {
      const state: ToolStoreState = {
        ...baseState,
        installedPlugins: [
          {
            identifier: 'plugin-a',
            type: 'plugin',
            manifest: { identifier: 'plugin-a', api: [], type: 'default' } as any,
            settings: {},
          },
          {
            identifier: 'plugin-c',
            type: 'plugin',
            manifest: { identifier: 'plugin-c', api: [], type: 'default' } as any,
            settings: {},
          },
        ],
        listType: 'installed',
      };
      const result = mcpStoreSelectors.mcpPluginList(state);

      expect(result).toHaveLength(2);
      expect(result.map((p) => p.identifier)).toEqual(['plugin-a', 'plugin-c']);
    });
  });

  describe('isPluginInstallLoading', () => {
    it('should return true when plugin is loading', () => {
      const state: ToolStoreState = {
        ...baseState,
        pluginInstallLoading: { 'plugin-a': true },
      };
      const result = mcpStoreSelectors.isPluginInstallLoading('plugin-a')(state);

      expect(result).toBe(true);
    });

    it('should return false when plugin is not loading', () => {
      const state: ToolStoreState = {
        ...baseState,
        pluginInstallLoading: { 'plugin-a': false },
      };
      const result = mcpStoreSelectors.isPluginInstallLoading('plugin-a')(state);

      expect(result).toBe(false);
    });

    it('should return undefined when plugin id is not in loading map', () => {
      const state: ToolStoreState = {
        ...baseState,
        pluginInstallLoading: {},
      };
      const result = mcpStoreSelectors.isPluginInstallLoading('nonexistent')(state);

      expect(result).toBeUndefined();
    });
  });

  describe('getMCPInstallProgress', () => {
    it('should return install progress for existing plugin', () => {
      const progress = { progress: 50, step: MCPInstallStep.INSTALLING_PLUGIN };
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: { 'plugin-a': progress },
      };
      const result = mcpStoreSelectors.getMCPInstallProgress('plugin-a')(state);

      expect(result).toEqual(progress);
    });

    it('should return undefined for plugin with no progress', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {},
      };
      const result = mcpStoreSelectors.getMCPInstallProgress('plugin-a')(state);

      expect(result).toBeUndefined();
    });
  });

  describe('isMCPInstalling', () => {
    it('should return true when install progress exists', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {
          'plugin-a': { progress: 30, step: MCPInstallStep.FETCHING_MANIFEST },
        },
      };
      const result = mcpStoreSelectors.isMCPInstalling('plugin-a')(state);

      expect(result).toBe(true);
    });

    it('should return false when no install progress exists', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {},
      };
      const result = mcpStoreSelectors.isMCPInstalling('plugin-a')(state);

      expect(result).toBe(false);
    });

    it('should return false when progress is undefined', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: { 'plugin-a': undefined },
      };
      const result = mcpStoreSelectors.isMCPInstalling('plugin-a')(state);

      expect(result).toBe(false);
    });
  });

  describe('getPluginById', () => {
    it('should return plugin when found by id', () => {
      const result = mcpStoreSelectors.getPluginById('plugin-b')(baseState);

      expect(result).toBeDefined();
      expect(result?.identifier).toBe('plugin-b');
    });

    it('should return undefined when plugin not found', () => {
      const result = mcpStoreSelectors.getPluginById('nonexistent')(baseState);

      expect(result).toBeUndefined();
    });

    it('should return undefined when mcpPluginItems is empty', () => {
      const state: ToolStoreState = { ...baseState, mcpPluginItems: [] };
      const result = mcpStoreSelectors.getPluginById('plugin-a')(state);

      expect(result).toBeUndefined();
    });
  });

  describe('activeMCPPluginIdentifier', () => {
    it('should return active MCP plugin identifier when set', () => {
      const state: ToolStoreState = { ...baseState, activeMCPIdentifier: 'plugin-a' };
      const result = mcpStoreSelectors.activeMCPPluginIdentifier(state);

      expect(result).toBe('plugin-a');
    });

    it('should return undefined when no active plugin', () => {
      const state: ToolStoreState = { ...baseState, activeMCPIdentifier: undefined };
      const result = mcpStoreSelectors.activeMCPPluginIdentifier(state);

      expect(result).toBeUndefined();
    });
  });

  describe('getMCPPluginRequiringConfig', () => {
    it('should return config schema when plugin requires config', () => {
      const configSchema = { type: 'object', properties: { apiKey: { type: 'string' } } };
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {
          'plugin-a': { progress: 100, step: MCPInstallStep.COMPLETED, configSchema },
        },
      };
      const result = mcpStoreSelectors.getMCPPluginRequiringConfig('plugin-a')(state);

      expect(result).toEqual(configSchema);
    });

    it('should return undefined when plugin has no config schema', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {
          'plugin-a': { progress: 100, step: MCPInstallStep.COMPLETED },
        },
      };
      const result = mcpStoreSelectors.getMCPPluginRequiringConfig('plugin-a')(state);

      expect(result).toBeUndefined();
    });

    it('should return undefined when plugin has no progress', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {},
      };
      const result = mcpStoreSelectors.getMCPPluginRequiringConfig('plugin-a')(state);

      expect(result).toBeUndefined();
    });
  });

  describe('isMCPPluginRequiringConfig', () => {
    it('should return true when plugin has config schema', () => {
      const configSchema = { type: 'object' };
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {
          'plugin-a': { progress: 100, step: MCPInstallStep.COMPLETED, configSchema },
        },
      };
      const result = mcpStoreSelectors.isMCPPluginRequiringConfig('plugin-a')(state);

      expect(result).toBe(true);
    });

    it('should return false when plugin has no config schema', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {
          'plugin-a': { progress: 100, step: MCPInstallStep.COMPLETED },
        },
      };
      const result = mcpStoreSelectors.isMCPPluginRequiringConfig('plugin-a')(state);

      expect(result).toBe(false);
    });

    it('should return false when plugin has no progress', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {},
      };
      const result = mcpStoreSelectors.isMCPPluginRequiringConfig('plugin-a')(state);

      expect(result).toBe(false);
    });
  });

  describe('isMCPInstallInProgress', () => {
    it('should return true when plugin is installing (not error, no needsConfig)', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {
          'plugin-a': { progress: 50, step: MCPInstallStep.INSTALLING_PLUGIN },
        },
      };
      const result = mcpStoreSelectors.isMCPInstallInProgress('plugin-a')(state);

      expect(result).toBe(true);
    });

    it('should return false when plugin step is Error', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {
          'plugin-a': { progress: 0, step: MCPInstallStep.ERROR },
        },
      };
      const result = mcpStoreSelectors.isMCPInstallInProgress('plugin-a')(state);

      expect(result).toBe(false);
    });

    it('should return false when plugin needsConfig is true', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {
          'plugin-a': {
            progress: 100,
            step: MCPInstallStep.COMPLETED,
            needsConfig: true,
          },
        },
      };
      const result = mcpStoreSelectors.isMCPInstallInProgress('plugin-a')(state);

      expect(result).toBe(false);
    });

    it('should return false when no progress exists', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {},
      };
      const result = mcpStoreSelectors.isMCPInstallInProgress('plugin-a')(state);

      expect(result).toBe(false);
    });

    it('should return true when progress is FETCHING_MANIFEST (no error, no needsConfig)', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpInstallProgress: {
          'plugin-a': { progress: 20, step: MCPInstallStep.FETCHING_MANIFEST },
        },
      };
      const result = mcpStoreSelectors.isMCPInstallInProgress('plugin-a')(state);

      expect(result).toBe(true);
    });
  });

  describe('isMCPConnectionTesting', () => {
    it('should return true when connection is being tested', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpTestLoading: { 'plugin-a': true },
      };
      const result = mcpStoreSelectors.isMCPConnectionTesting('plugin-a')(state);

      expect(result).toBe(true);
    });

    it('should return false when connection is not being tested', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpTestLoading: { 'plugin-a': false },
      };
      const result = mcpStoreSelectors.isMCPConnectionTesting('plugin-a')(state);

      expect(result).toBe(false);
    });

    it('should return false when plugin id is not in test loading map', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpTestLoading: {},
      };
      const result = mcpStoreSelectors.isMCPConnectionTesting('plugin-a')(state);

      expect(result).toBe(false);
    });
  });

  describe('getMCPConnectionTestError', () => {
    it('should return error message when test failed', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpTestErrors: { 'plugin-a': 'Connection refused' },
      };
      const result = mcpStoreSelectors.getMCPConnectionTestError('plugin-a')(state);

      expect(result).toBe('Connection refused');
    });

    it('should return undefined when no test error exists', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpTestErrors: {},
      };
      const result = mcpStoreSelectors.getMCPConnectionTestError('plugin-a')(state);

      expect(result).toBeUndefined();
    });
  });

  describe('getMCPConnectionTestState', () => {
    it('should return both error and loading state', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpTestErrors: { 'plugin-a': 'Timeout' },
        mcpTestLoading: { 'plugin-a': false },
      };
      const result = mcpStoreSelectors.getMCPConnectionTestState('plugin-a')(state);

      expect(result).toEqual({ error: 'Timeout', loading: false });
    });

    it('should return loading true when testing', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpTestErrors: {},
        mcpTestLoading: { 'plugin-a': true },
      };
      const result = mcpStoreSelectors.getMCPConnectionTestState('plugin-a')(state);

      expect(result).toEqual({ error: undefined, loading: true });
    });

    it('should return default values when plugin has no test state', () => {
      const state: ToolStoreState = {
        ...baseState,
        mcpTestErrors: {},
        mcpTestLoading: {},
      };
      const result = mcpStoreSelectors.getMCPConnectionTestState('plugin-a')(state);

      expect(result).toEqual({ error: undefined, loading: false });
    });
  });
});
