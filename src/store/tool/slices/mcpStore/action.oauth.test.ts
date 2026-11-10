import type { ToolManifest } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReplicaModule from '@/libs/replica';
import { discoverService } from '@/services/discover';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import type { ToolStore } from '@/store/tool/store';
import { MCPInstallStep } from '@/types/plugins';
import type * as ConnectorOAuthModule from '@/utils/connectorOAuth';
import { ConnectorOAuthError, waitForConnectorOAuth } from '@/utils/connectorOAuth';

import { createMCPPluginStoreSlice } from './action';
import { mcpStoreSelectors } from './selectors';

vi.mock('@/libs/replica', async (original) => ({
  ...(await original<typeof ReplicaModule>()),
  createReplicaSlice: () => ({}),
}));
vi.mock('./projection', () => ({ MCP_PLUGIN_LIST_KEY: 'all', mcpPluginListResource: {} }));
vi.mock('@/store/tool/selectors', () => ({
  mcpStoreSelectors: {
    getPluginById: () => () => ({ identifier: 'market-mcp', manifestUrl: 'manifest' }),
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
vi.mock('@/utils/connectorOAuth', async (original) => ({
  ...(await original<typeof ConnectorOAuthModule>()),
  openConnectorOAuthPopup: () => popup,
  waitForConnectorOAuth: vi.fn(),
}));
const popup = vi.hoisted(() => ({ close: vi.fn(), closed: false }) as unknown as Window);

const manifestData = {
  name: 'Market MCP',
  version: '1.0.0',
  deploymentOptions: [
    {
      connection: {
        type: 'http',
        url: 'https://oauth.example/mcp',
        auth: { type: 'oauth2' },
      },
    },
  ],
};
let state: ToolStore;
let actions: ReturnType<typeof createMCPPluginStoreSlice>;
const connected = () => ({
  id: 'connector-1',
  identifier: 'market-mcp',
  name: 'Market MCP',
  sourceType: 'marketplace',
  status: 'connected',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://oauth.example/mcp',
  credentials: null,
  metadata: null,
  tools: [
    {
      id: 'tool-1',
      userConnectorId: 'connector-1',
      toolName: 'list_tasks',
      displayName: null,
      description: 'List tasks',
      inputSchema: { type: 'object' },
      crudType: 'read',
      permission: 'auto',
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state = {
    mcpInstallProgress: {},
    mcpInstallAbortControllers: {},
    connectors: [],
    installedPlugins: [],
    createConnector: vi.fn().mockResolvedValue({ id: 'connector-1', isNew: true }),
    deleteConnector: vi.fn().mockResolvedValue(undefined),
    startConnectorOAuth: vi.fn().mockResolvedValue('https://oauth.example/authorize'),
    fetchConnectors: vi.fn(async () => {
      state.connectors = [connected() as never];
    }),
    refreshPlugins: vi.fn().mockResolvedValue(undefined),
    uninstallPlugin: vi.fn().mockResolvedValue(undefined),
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
  vi.mocked(waitForConnectorOAuth).mockResolvedValue(undefined);
  vi.mocked(pluginService.installPlugin).mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

const prepare = async () => {
  await actions.installMCPPlugin('market-mcp');
};

describe('marketplace OAuth MCP installation', () => {
  it('asks for authorization before probing the unauthenticated tool list', async () => {
    await prepare();
    expect(state.mcpInstallProgress['market-mcp']?.step).toBe(
      MCPInstallStep.AUTHORIZATION_REQUIRED,
    );
    expect(mcpService.getStreamableMcpServerManifest).not.toHaveBeenCalled();
    expect(pluginService.installPlugin).not.toHaveBeenCalled();
  });

  it('offers OAuth discovery when an unmarked endpoint returns an authorization challenge', async () => {
    const data = structuredClone(manifestData);
    data.deploymentOptions[0].connection.auth.type = 'none';
    vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue(data as never);
    vi.mocked(mcpService.getStreamableMcpServerManifest).mockRejectedValueOnce(
      Object.assign(new Error('401'), {
        data: { errorData: { type: 'AUTHORIZATION_ERROR', message: '401' } },
      }),
    );
    await prepare();
    expect(state.mcpInstallProgress['market-mcp']).toMatchObject({
      step: MCPInstallStep.AUTHORIZATION_REQUIRED,
      connection: { auth: { type: 'oauth2' } },
    });
    expect(pluginService.installPlugin).not.toHaveBeenCalled();
  });

  it('does not infer OAuth from an unrelated server failure', async () => {
    const data = structuredClone(manifestData);
    data.deploymentOptions[0].connection.auth.type = 'none';
    vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue(data as never);
    vi.mocked(mcpService.getStreamableMcpServerManifest).mockRejectedValueOnce(
      new Error('Unavailable'),
    );
    await prepare();
    expect(state.mcpInstallProgress['market-mcp']?.step).toBe(MCPInstallStep.ERROR);
    expect(mcpStoreSelectors.isMCPInstalling('market-mcp')(state)).toBe(false);
  });

  it('installs the synchronized tools only after successful OAuth without copying tokens to the plugin', async () => {
    await prepare();
    expect(await actions.authorizeMCPPlugin('market-mcp')).toBe(true);
    expect(state.startConnectorOAuth).toHaveBeenCalled();
    expect(waitForConnectorOAuth).toHaveBeenCalled();
    const installed = vi.mocked(pluginService.installPlugin).mock.calls[0][0];
    expect(installed.manifest.api.map((tool) => tool.name)).toEqual(['list_tasks']);
    expect(installed.manifest.meta?.title).toBe('Market MCP');
    expect(JSON.stringify(installed)).not.toContain('accessToken');
    expect(state.mcpInstallProgress['market-mcp']).toBeUndefined();
    expect(popup.close).toHaveBeenCalled();
  });

  it('allows retry after a rejected registration and deletes only the newly created connector', async () => {
    await prepare();
    vi.mocked(state.startConnectorOAuth).mockRejectedValueOnce(new Error('Registration rejected'));
    await actions.authorizeMCPPlugin('market-mcp');
    expect(state.deleteConnector).toHaveBeenCalledWith('connector-1');
    expect(pluginService.installPlugin).not.toHaveBeenCalled();
    expect(state.mcpInstallProgress['market-mcp']).toMatchObject({
      step: MCPInstallStep.AUTHORIZATION_REQUIRED,
      errorInfo: { message: 'Registration rejected' },
    });
    expect(await actions.authorizeMCPPlugin('market-mcp')).toBe(true);
  });

  it('keeps an existing connector if authorization cannot start', async () => {
    await prepare();
    vi.mocked(state.createConnector).mockResolvedValue({ id: 'connector-1', isNew: false });
    vi.mocked(state.startConnectorOAuth).mockRejectedValueOnce(new Error('Registration rejected'));
    await actions.authorizeMCPPlugin('market-mcp');
    expect(state.deleteConnector).not.toHaveBeenCalled();
  });

  it('does not install when the provider authorization fails', async () => {
    await prepare();
    vi.mocked(waitForConnectorOAuth).mockRejectedValueOnce(new ConnectorOAuthError('failed'));
    await actions.authorizeMCPPlugin('market-mcp');
    expect(pluginService.installPlugin).not.toHaveBeenCalled();
    expect(state.mcpInstallProgress['market-mcp']).toMatchObject({
      step: MCPInstallStep.AUTHORIZATION_REQUIRED,
      errorInfo: { message: 'failed' },
    });
  });

  it('does not complete an installation canceled while authorization is in flight', async () => {
    await prepare();
    let complete!: () => void;
    vi.mocked(waitForConnectorOAuth).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const installation = actions.authorizeMCPPlugin('market-mcp');
    await vi.waitFor(() => expect(waitForConnectorOAuth).toHaveBeenCalled());
    await actions.cancelInstallMCPPlugin('market-mcp');
    complete();
    await installation;
    expect(pluginService.installPlugin).not.toHaveBeenCalled();
    expect(state.mcpInstallProgress['market-mcp']).toBeUndefined();
  });

  it('preserves custom headers across the authorization pause and retries', async () => {
    const data = structuredClone(manifestData);
    Object.assign(data.deploymentOptions[0].connection, { headers: { 'X-Project': 'project-1' } });
    vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue(data as never);
    await prepare();
    await actions.authorizeMCPPlugin('market-mcp');
    expect(state.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ customHeaders: { 'X-Project': 'project-1' } }),
      }),
    );
  });

  it('keeps OAuth credentials and custom headers out of the installed plugin snapshot', async () => {
    const data = structuredClone(manifestData);
    Object.assign(data.deploymentOptions[0].connection.auth, {
      accessToken: 'private-access-token',
      clientId: 'client-id',
      clientSecret: 'private-client-secret',
    });
    Object.assign(data.deploymentOptions[0].connection, {
      headers: { 'X-Api-Key': 'private-header' },
    });
    vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue(data as never);
    await prepare();
    await actions.authorizeMCPPlugin('market-mcp');
    const installed = JSON.stringify(vi.mocked(pluginService.installPlugin).mock.calls[0][0]);
    expect(installed).not.toContain('private-access-token');
    expect(installed).not.toContain('private-client-secret');
    expect(installed).not.toContain('private-header');
  });

  it('keeps regular HTTP installations on the existing direct connection path', async () => {
    const data = structuredClone(manifestData);
    data.deploymentOptions[0].connection.auth.type = 'none';
    vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue(data as never);
    vi.mocked(mcpService.getStreamableMcpServerManifest).mockResolvedValue({
      api: [],
      identifier: 'market-mcp',
    } as unknown as ToolManifest);
    expect(await actions.installMCPPlugin('market-mcp')).toBe(true);
    expect(state.createConnector).not.toHaveBeenCalled();
    expect(mcpService.getStreamableMcpServerManifest).toHaveBeenCalled();
  });

  it('removes the server-held marketplace credential when uninstalling', async () => {
    state.installedPlugins = [
      {
        identifier: 'market-mcp',
        customParams: {
          mcp: { type: 'http', url: 'https://oauth.example/mcp', auth: { type: 'oauth2' } },
        },
      } as never,
    ];
    state.connectors = [connected() as never];
    await actions.uninstallMCPPlugin('market-mcp');
    expect(state.deleteConnector).toHaveBeenCalledWith('connector-1');
    expect(state.uninstallPlugin).toHaveBeenCalledWith('market-mcp');
  });

  it('uninstalls a regular MCP without removing any connector', async () => {
    vi.mocked(state.fetchConnectors).mockRejectedValueOnce(new Error('Connector API unavailable'));
    await actions.uninstallMCPPlugin('market-mcp');
    expect(state.fetchConnectors).not.toHaveBeenCalled();
    expect(state.deleteConnector).not.toHaveBeenCalled();
    expect(state.uninstallPlugin).toHaveBeenCalledWith('market-mcp');
  });

  it('confirms cached plugin records before deciding whether to remove OAuth credentials', async () => {
    state.installedPlugins = [
      { identifier: 'market-mcp', customParams: { mcp: { type: 'http' } } } as never,
    ];
    state.installedPluginsReplica = { entries: { installed: { source: 'storage' } } } as never;
    vi.mocked(state.refreshPlugins).mockImplementationOnce(async () => {
      state.installedPluginsReplica = { entries: { installed: { source: 'server' } } } as never;
      state.installedPlugins = [
        {
          identifier: 'market-mcp',
          customParams: {
            mcp: { type: 'http', url: 'https://oauth.example/mcp', auth: { type: 'oauth2' } },
          },
        } as never,
      ];
    });
    await actions.uninstallMCPPlugin('market-mcp');
    expect(state.refreshPlugins).toHaveBeenCalledOnce();
    expect(state.deleteConnector).toHaveBeenCalledWith('connector-1');
    expect(state.uninstallPlugin).toHaveBeenCalledWith('market-mcp');
  });
});
