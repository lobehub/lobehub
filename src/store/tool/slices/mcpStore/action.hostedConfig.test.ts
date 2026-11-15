import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReplicaModule from '@/libs/replica';
import { discoverService } from '@/services/discover';
import { mcpService } from '@/services/mcp';
import type { ToolStore } from '@/store/tool/store';

import { createMCPPluginStoreSlice } from './action';
import { installMarketplaceConnector } from './installMarketplaceConnector';

const environment = vi.hoisted(() => ({ isDesktop: true }));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  get isDesktop() {
    return environment.isDesktop;
  },
}));
vi.mock('@/libs/replica', async (original) => ({
  ...(await original<typeof ReplicaModule>()),
  createReplicaSlice: () => ({}),
}));
vi.mock('./projection', () => ({ MCP_PLUGIN_LIST_KEY: 'all', mcpPluginListResource: {} }));
vi.mock('@/store/tool/selectors', () => ({
  mcpStoreSelectors: {
    getPluginById: () => () => ({
      haveCloudEndpoint: true,
      identifier: 'hosted-mcp',
      manifestUrl: 'manifest',
    }),
  },
}));
vi.mock('@/services/discover', () => ({
  discoverService: {
    getMCPPluginManifest: vi.fn(),
    reportMcpEvent: vi.fn(),
    reportMcpInstallResult: vi.fn(),
  },
}));
vi.mock('@/services/mcp', () => ({
  mcpService: { checkInstallation: vi.fn(), getStdioMcpServerManifest: vi.fn() },
}));
vi.mock('./installMarketplaceConnector', () => ({ installMarketplaceConnector: vi.fn() }));
vi.mock('@/utils/sleep', () => ({ sleep: async () => {} }));

const HOSTED_URL = 'https://runtime.example.com/runtimes/hosted-mcp/invocations';
// Market's crawler writes config placeholders into args for the client to fill
const stdioConnection = {
  args: ['-y', 'hosted-mcp', 'API_KEY={{config.API_KEY}}'],
  command: 'npx',
  type: 'stdio',
};

// The shape Market serves for a hosted plugin: its runtime URL as the recommended
// `none` option (callable only through the cloud gateway), plus the package itself
const manifestData = (required = ['API_KEY']) => ({
  name: 'Hosted MCP',
  version: '1.0.0',
  deploymentOptions: [
    {
      connection: { type: 'http', url: HOSTED_URL },
      installationMethod: 'none',
      isRecommended: true,
    },
    {
      connection: {
        ...stdioConnection,
        configSchema: { properties: { API_KEY: { type: 'string' } }, required, type: 'object' },
      },
      installationMethod: 'npm',
      isRecommended: true,
    },
  ],
});

let state: ToolStore;
let actions: ReturnType<typeof createMCPPluginStoreSlice>;

beforeEach(() => {
  vi.clearAllMocks();
  environment.isDesktop = true;
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
  vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue(manifestData() as never);
  vi.mocked(mcpService.checkInstallation).mockResolvedValue({
    allDependenciesMet: true,
    connection: stdioConnection,
    needsConfig: false,
    success: true,
  } as never);
  vi.mocked(mcpService.getStdioMcpServerManifest).mockResolvedValue({
    api: [],
    identifier: 'hosted-mcp',
    meta: { title: 'Hosted MCP' },
  } as never);
  vi.mocked(installMarketplaceConnector).mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('hosted MCP plugins that need user config', () => {
  it('should run the package locally on desktop so the config reaches the server', async () => {
    await actions.installMCPPlugin('hosted-mcp', { config: { API_KEY: 'user-key' } });

    // Only the package options are checked: the hosted runtime URL is not callable directly
    expect(mcpService.checkInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentOptions: [expect.objectContaining({ installationMethod: 'npm' })],
      }),
      expect.any(AbortSignal),
    );
    expect(mcpService.getStdioMcpServerManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['-y', 'hosted-mcp', 'API_KEY=user-key'],
        command: 'npx',
        env: { API_KEY: 'user-key' },
      }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(installMarketplaceConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        // A connector has no settings to fill the args on each call: it stores them filled
        connection: expect.objectContaining({
          args: ['-y', 'hosted-mcp', 'API_KEY=user-key'],
          command: 'npx',
          env: { API_KEY: 'user-key' },
          type: 'stdio',
        }),
      }),
      expect.any(Function),
    );
  });

  it('should keep the cloud connection on desktop when no config is required', async () => {
    vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue(manifestData([]) as never);

    await actions.installMCPPlugin('hosted-mcp');

    expect(mcpService.checkInstallation).not.toHaveBeenCalled();
    expect(installMarketplaceConnector).toHaveBeenCalledWith(
      expect.objectContaining({ connection: expect.objectContaining({ type: 'cloud' }) }),
      expect.any(Function),
    );
  });

  it('should keep the cloud connection on web, where packages cannot run', async () => {
    environment.isDesktop = false;

    await actions.installMCPPlugin('hosted-mcp', { config: { API_KEY: 'user-key' } });

    expect(mcpService.checkInstallation).not.toHaveBeenCalled();
    expect(installMarketplaceConnector).toHaveBeenCalledWith(
      expect.objectContaining({ connection: expect.objectContaining({ type: 'cloud' }) }),
      expect.any(Function),
    );
  });
});
