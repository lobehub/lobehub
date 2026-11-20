import type { ToolManifest } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReplicaModule from '@/libs/replica';
import { discoverService } from '@/services/discover';
import { mcpService } from '@/services/mcp';
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
/** Whether the server holds the marketplace row: a fresh install has none until `create`. */
let stored: boolean;
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
  stored = false;
  state = {
    mcpInstallProgress: {},
    mcpInstallAbortControllers: {},
    connectors: [],
    installedPlugins: [],
    createConnector: vi.fn(async () => {
      const isNew = !stored;
      stored = true;
      state.connectors = [connected() as never];
      return { id: 'connector-1', isNew };
    }),
    deleteConnector: vi.fn(async () => {
      stored = false;
      state.connectors = [];
    }),
    // An OAuth row's edit read: its client config, never its tokens
    getConnectorForEdit: vi.fn(async () => ({ ...connected(), oidcConfig: { scheme: 'dcr' } })),
    startConnectorOAuth: vi.fn().mockResolvedValue('https://oauth.example/authorize'),
    fetchConnectors: vi.fn(async () => {
      state.connectors = stored ? [connected() as never] : [];
    }),
    refreshPlugins: vi.fn().mockResolvedValue(undefined),
    syncConnectorTools: vi.fn().mockResolvedValue(undefined),
    updateConnector: vi.fn().mockResolvedValue(undefined),
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
    expect(state.updateConnector).not.toHaveBeenCalled();
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
    expect(state.updateConnector).not.toHaveBeenCalled();
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

  it('marks the authorized connector installed only after successful OAuth', async () => {
    await prepare();
    expect(await actions.authorizeMCPPlugin('market-mcp')).toBe(true);
    expect(state.startConnectorOAuth).toHaveBeenCalled();
    expect(waitForConnectorOAuth).toHaveBeenCalled();
    expect(state.updateConnector).toHaveBeenCalledWith('connector-1', {
      metadata: { marketplaceInstalled: true },
    });
    // OAuth already synced the tools on the server; nothing else is written.
    expect(state.syncConnectorTools).not.toHaveBeenCalled();
    expect(state.refreshPlugins).not.toHaveBeenCalled();
    expect(state.mcpInstallProgress['market-mcp']).toBeUndefined();
    expect(popup.close).toHaveBeenCalled();
  });

  it('allows retry after a rejected registration and deletes only the newly created connector', async () => {
    await prepare();
    vi.mocked(state.startConnectorOAuth).mockRejectedValueOnce(new Error('Registration rejected'));
    await actions.authorizeMCPPlugin('market-mcp');
    expect(state.deleteConnector).toHaveBeenCalledWith('connector-1');
    expect(state.updateConnector).not.toHaveBeenCalled();
    expect(state.mcpInstallProgress['market-mcp']).toMatchObject({
      step: MCPInstallStep.AUTHORIZATION_REQUIRED,
      errorInfo: { message: 'Registration rejected' },
    });
    expect(await actions.authorizeMCPPlugin('market-mcp')).toBe(true);
  });

  it('keeps an existing connector if authorization cannot start', async () => {
    stored = true;
    await prepare();
    vi.mocked(state.startConnectorOAuth).mockRejectedValueOnce(new Error('Registration rejected'));
    await actions.authorizeMCPPlugin('market-mcp');
    expect(state.deleteConnector).not.toHaveBeenCalled();
  });

  // `create` rewrote the installed row before the popup opened: a reinstall
  // whose authorization fails must not leave it on the unauthorized endpoint
  it.each([
    ['dismissed', new ConnectorOAuthError('dismissed')],
    ['denied', new ConnectorOAuthError('failed')],
    ['timed out', new ConnectorOAuthError('timeout')],
  ])('restores the row a reinstall replaced when authorization is %s', async (_, error) => {
    stored = true;
    vi.mocked(state.getConnectorForEdit).mockResolvedValue({
      ...connected(),
      metadata: { marketplaceInstalled: true },
      mcpServerUrl: 'https://old.example/mcp',
      oidcConfig: { scheme: 'dcr' },
    } as never);
    vi.mocked(waitForConnectorOAuth).mockRejectedValueOnce(error);
    await prepare();

    await actions.authorizeMCPPlugin('market-mcp');

    expect(state.deleteConnector).not.toHaveBeenCalled();
    expect(state.updateConnector).toHaveBeenCalledTimes(1);
    expect(state.updateConnector).toHaveBeenCalledWith(
      'connector-1',
      expect.objectContaining({
        metadata: { marketplaceInstalled: true },
        mcpServerUrl: 'https://old.example/mcp',
      }),
    );
    // Its OAuth tokens are withheld from the edit read: its server decides its status
    expect(state.syncConnectorTools).toHaveBeenCalledWith('connector-1', {
      pruneMissingAutoTools: true,
    });
  });

  it('does not install when the provider authorization fails', async () => {
    await prepare();
    vi.mocked(waitForConnectorOAuth).mockRejectedValueOnce(new ConnectorOAuthError('failed'));
    await actions.authorizeMCPPlugin('market-mcp');
    expect(state.updateConnector).not.toHaveBeenCalled();
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
    expect(state.updateConnector).not.toHaveBeenCalled();
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

  it('keeps OAuth credentials out of the install mark', async () => {
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
    const marked = JSON.stringify(vi.mocked(state.updateConnector).mock.calls[0]);
    expect(marked).toContain('marketplaceInstalled');
    expect(marked).not.toContain('private-access-token');
    expect(marked).not.toContain('private-client-secret');
  });

  it('stores a regular HTTP installation as a marketplace connector without OAuth', async () => {
    const data = structuredClone(manifestData);
    data.deploymentOptions[0].connection.auth.type = 'none';
    vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue(data as never);
    vi.mocked(mcpService.getStreamableMcpServerManifest).mockResolvedValue({
      api: [],
      identifier: 'market-mcp',
    } as unknown as ToolManifest);
    expect(await actions.installMCPPlugin('market-mcp')).toBe(true);
    expect(mcpService.getStreamableMcpServerManifest).toHaveBeenCalled();
    expect(state.startConnectorOAuth).not.toHaveBeenCalled();
    expect(state.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'market-mcp',
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://oauth.example/mcp',
        sourceType: 'marketplace',
      }),
    );
    expect(vi.mocked(state.createConnector).mock.calls[0][0]).not.toHaveProperty('oidcConfig');
    expect(state.syncConnectorTools).toHaveBeenCalledWith('connector-1', {
      pruneMissingAutoTools: true,
    });
    expect(state.updateConnector).toHaveBeenCalledWith('connector-1', {
      metadata: { marketplaceInstalled: true },
    });
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
    stored = true;
    await actions.uninstallMCPPlugin('market-mcp');
    expect(state.deleteConnector).toHaveBeenCalledWith('connector-1');
    expect(state.uninstallPlugin).toHaveBeenCalledWith('market-mcp');
  });

  it('still removes the legacy row when the connector list cannot load', async () => {
    vi.mocked(state.fetchConnectors).mockRejectedValueOnce(new Error('Connector API unavailable'));
    await actions.uninstallMCPPlugin('market-mcp');
    expect(state.deleteConnector).not.toHaveBeenCalled();
    expect(state.uninstallPlugin).toHaveBeenCalledWith('market-mcp');
  });

  it('removes a connector-only install', async () => {
    vi.mocked(state.fetchConnectors).mockImplementationOnce(async () => {
      state.connectors = [
        { ...connected(), metadata: { marketplaceInstalled: true }, mcpConnectionType: 'cloud' },
      ] as never;
    });
    await actions.uninstallMCPPlugin('market-mcp');
    expect(state.deleteConnector).toHaveBeenCalledWith('connector-1');
    expect(state.uninstallPlugin).toHaveBeenCalledWith('market-mcp');
  });

  it('keeps an endpoint-less marketplace tool projection', async () => {
    vi.mocked(state.fetchConnectors).mockImplementationOnce(async () => {
      state.connectors = [{ ...connected(), mcpConnectionType: null, mcpServerUrl: null }] as never;
    });
    await actions.uninstallMCPPlugin('market-mcp');
    expect(state.deleteConnector).not.toHaveBeenCalled();
  });
});
