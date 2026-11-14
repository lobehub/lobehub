import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReplicaModule from '@/libs/replica';
import { discoverService } from '@/services/discover';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import type { ToolStore } from '@/store/tool/store';

import { createMCPPluginStoreSlice } from './action';

vi.mock('@/libs/replica', async (original) => ({
  ...(await original<typeof ReplicaModule>()),
  createReplicaSlice: () => ({}),
}));
vi.mock('./projection', () => ({ MCP_PLUGIN_LIST_KEY: 'all', mcpPluginListResource: {} }));
vi.mock('@/store/tool/selectors', () => ({
  mcpStoreSelectors: {
    getPluginById: () => () => ({ identifier: 'quote-mcp', manifestUrl: 'manifest' }),
  },
}));
vi.mock('@/services/discover', () => ({
  discoverService: {
    getMCPPluginManifest: vi.fn(),
    reportMcpEvent: vi.fn(),
    reportMcpInstallResult: vi.fn(),
  },
}));
vi.mock('@/services/mcp', () => ({ mcpService: { getStreamableMcpServerManifest: vi.fn() } }));
vi.mock('@/services/plugin', () => ({ pluginService: { installPlugin: vi.fn() } }));
vi.mock('@/utils/sleep', () => ({ sleep: async () => {} }));

const TEMPLATE_URL = 'https://quotes.example.com/mcp?apikey={{API_KEY}}';

const manifestData = {
  name: 'Quote MCP',
  version: '1.0.0',
  deploymentOptions: [
    {
      connection: {
        configSchema: {
          properties: { API_KEY: { type: 'string' }, X_REGION: { type: 'string' } },
          required: ['API_KEY'],
          type: 'object',
        },
        headers: { 'X-Client': 'lobehub' },
        type: 'http',
        url: TEMPLATE_URL,
      },
    },
  ],
};

let state: ToolStore;
let actions: ReturnType<typeof createMCPPluginStoreSlice>;

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    mcpInstallAbortControllers: {},
    mcpInstallProgress: {},
    refreshPlugins: vi.fn().mockResolvedValue(undefined),
    updateInstallLoadingState: vi.fn(),
    updateMCPInstallProgress: (id: string, progress: unknown) => {
      state.mcpInstallProgress = { ...state.mcpInstallProgress, [id]: progress as never };
    },
  } as unknown as ToolStore;
  actions = createMCPPluginStoreSlice(
    (update) => {
      state = { ...state, ...(typeof update === 'function' ? update(state) : update) };
    },
    () => state,
  );
  vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue(
    structuredClone(manifestData) as never,
  );
  vi.mocked(mcpService.getStreamableMcpServerManifest).mockResolvedValue({
    api: [],
    identifier: 'quote-mcp',
    meta: { title: 'Quote MCP' },
  } as never);
  vi.mocked(pluginService.installPlugin).mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('marketplace HTTP MCP with config placeholders in the URL', () => {
  it('sends the config values the URL uses in the URL, and the rest as headers', async () => {
    await actions.installMCPPlugin('quote-mcp', {
      config: { API_KEY: 'k&1', X_REGION: 'eu' },
      resume: false,
    });

    expect(mcpService.getStreamableMcpServerManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'X-Client': 'lobehub', 'X_REGION': 'eu' },
        url: 'https://quotes.example.com/mcp?apikey=k%261',
      }),
      expect.any(AbortSignal),
    );
  });

  it('stores the template URL so the key stays in settings, not in the saved connection', async () => {
    await actions.installMCPPlugin('quote-mcp', {
      config: { API_KEY: 'k&1', X_REGION: 'eu' },
      resume: false,
    });

    expect(pluginService.installPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        customParams: {
          mcp: expect.objectContaining({
            headers: { 'X-Client': 'lobehub', 'X_REGION': 'eu' },
            type: 'http',
            url: TEMPLATE_URL,
          }),
        },
        settings: { API_KEY: 'k&1', X_REGION: 'eu' },
      }),
    );
  });
});
