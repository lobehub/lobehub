import type { ToolManifest } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import type { ToolStore } from '@/store/tool/store';

import { installMarketplaceConnector } from './installMarketplaceConnector';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: { syncToolsFromClientById: { mutate: vi.fn() } },
  },
}));

const manifest = {
  api: [{ description: 'Search', name: 'search', parameters: { type: 'object' } }],
  identifier: 'market-mcp',
} as unknown as ToolManifest;

let state: ToolStore;

const install = (connection: Record<string, any>, patch: { isOAuth?: boolean } = {}) =>
  installMarketplaceConnector(
    {
      connection,
      description: 'desc',
      icon: 'icon',
      identifier: 'market-mcp',
      isOAuth: patch.isOAuth ?? false,
      manifest,
      name: 'Market MCP',
      signal: new AbortController().signal,
    },
    () => state,
  );

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    connectors: [],
    createConnector: vi.fn(async () => {
      state.connectors = [{ id: 'connector-1', metadata: { avatar: 'icon' } }] as never;
      return { id: 'connector-1', isNew: true };
    }),
    deleteConnector: vi.fn().mockResolvedValue(undefined),
    fetchConnectors: vi.fn().mockResolvedValue(undefined),
    getConnectorForEdit: vi.fn(),
    syncConnectorTools: vi.fn().mockResolvedValue(undefined),
    updateConnector: vi.fn().mockResolvedValue(undefined),
  } as unknown as ToolStore;
});

describe('installMarketplaceConnector', () => {
  it('creates an http connector, syncs its tools on the server and marks the install', async () => {
    await install({
      auth: { token: 'secret', type: 'bearer' },
      headers: { 'X-Key': 'k' },
      type: 'http',
      url: 'https://mcp.example.com',
    });

    expect(state.createConnector).toHaveBeenCalledWith({
      credentials: { token: 'secret', type: 'bearer' },
      identifier: 'market-mcp',
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mcp.example.com',
      metadata: { avatar: 'icon', customHeaders: { 'X-Key': 'k' }, description: 'desc' },
      name: 'Market MCP',
      sourceType: 'marketplace',
    });
    expect(state.syncConnectorTools).toHaveBeenCalledWith('connector-1', {
      pruneMissingAutoTools: true,
    });
    expect(state.updateConnector).toHaveBeenCalledWith('connector-1', {
      metadata: { avatar: 'icon', marketplaceInstalled: true },
    });
  });

  // Each call reported to the Market names the version that was installed
  it('records the manifest version it installed', async () => {
    await installMarketplaceConnector(
      {
        connection: { type: 'http', url: 'https://mcp.example.com' },
        identifier: 'market-mcp',
        isOAuth: false,
        manifest: { ...manifest, version: '1.2.0' },
        name: 'Market MCP',
        signal: new AbortController().signal,
      },
      () => state,
    );

    expect(vi.mocked(state.createConnector).mock.calls[0][0].metadata).toMatchObject({
      version: '1.2.0',
    });
  });

  it('stores a stdio command on the connector', async () => {
    await install({ args: ['-y', 'pkg'], command: 'npx', env: { A: '1' }, type: 'stdio' });

    expect(state.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpConnectionType: 'stdio',
        mcpStdioConfig: { args: ['-y', 'pkg'], command: 'npx', env: { A: '1' } },
      }),
    );
    expect(state.syncConnectorTools).toHaveBeenCalledWith('connector-1', {
      pruneMissingAutoTools: true,
    });
  });

  it('syncs a cloud connector from the market manifest instead of connecting', async () => {
    await install({ cloudEndPoint: 'https://cloud.example', type: 'cloud' });

    expect(state.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpConnectionType: 'cloud',
        metadata: expect.objectContaining({ cloudEndPoint: 'https://cloud.example' }),
      }),
    );
    expect(state.syncConnectorTools).not.toHaveBeenCalled();
    // A reinstall's manifest replaces the stored tools: the ones it dropped go
    expect(lambdaClient.connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
      id: 'connector-1',
      pruneMissingAutoTools: true,
      tools: [{ description: 'Search', inputSchema: { type: 'object' }, toolName: 'search' }],
    });
  });

  it("carries a cloud manifest's approval requirements into the synced tools", async () => {
    const api = [
      { description: 'Send', humanIntervention: 'required', name: 'send', parameters: {} },
      { description: 'Wipe', humanIntervention: 'always', name: 'wipe', parameters: {} },
    ];
    await installMarketplaceConnector(
      {
        connection: { cloudEndPoint: 'https://cloud.example', type: 'cloud' },
        identifier: 'market-mcp',
        isOAuth: false,
        manifest: { ...manifest, api } as unknown as ToolManifest,
        name: 'Market MCP',
        signal: new AbortController().signal,
      },
      () => state,
    );

    expect(lambdaClient.connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
      id: 'connector-1',
      pruneMissingAutoTools: true,
      tools: [
        expect.objectContaining({ humanIntervention: 'required', toolName: 'send' }),
        expect.objectContaining({ humanIntervention: 'always', toolName: 'wipe' }),
      ],
    });
  });

  it('only marks the connector an OAuth install already authorized', async () => {
    state.connectors = [{ id: 'oauth-1', identifier: 'market-mcp', metadata: null }] as never;

    await install(
      { auth: { type: 'oauth2' }, type: 'http', url: 'https://mcp.example.com' },
      {
        isOAuth: true,
      },
    );

    expect(state.createConnector).not.toHaveBeenCalled();
    expect(state.syncConnectorTools).not.toHaveBeenCalled();
    expect(state.updateConnector).toHaveBeenCalledWith('oauth-1', {
      metadata: { marketplaceInstalled: true },
    });
  });

  // The authorization's own sync only adds to the tools of the row it reused
  it('lists the tools of an OAuth reinstall again, so the ones its server dropped go', async () => {
    state.connectors = [{ id: 'oauth-1', identifier: 'market-mcp', metadata: null }] as never;

    await installMarketplaceConnector(
      {
        connection: { auth: { type: 'oauth2' }, type: 'http', url: 'https://mcp.example.com' },
        identifier: 'market-mcp',
        isOAuth: true,
        manifest,
        name: 'Market MCP',
        oauthReplaced: { id: 'oauth-1', status: 'connected', tools: [] } as never,
        signal: new AbortController().signal,
      },
      () => state,
    );

    expect(state.createConnector).not.toHaveBeenCalled();
    expect(state.syncConnectorTools).toHaveBeenCalledWith('oauth-1', {
      pruneMissingAutoTools: true,
    });
    expect(vi.mocked(state.syncConnectorTools).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(state.updateConnector).mock.invocationCallOrder[0],
    );
  });

  it('removes the connector it created and leaves no install mark when the sync fails', async () => {
    vi.mocked(state.syncConnectorTools).mockRejectedValue(new Error('unreachable'));

    await expect(install({ type: 'http', url: 'https://down.example' })).rejects.toThrow(
      'unreachable',
    );
    expect(state.deleteConnector).toHaveBeenCalledWith('connector-1');
    expect(state.updateConnector).not.toHaveBeenCalled();
  });

  it('leaves the install mark off the replacement until its tools are synced', async () => {
    state.connectors = [
      {
        id: 'connector-1',
        identifier: 'market-mcp',
        metadata: { marketplaceInstalled: true },
        sourceType: 'marketplace',
      },
    ] as never;
    vi.mocked(state.getConnectorForEdit).mockResolvedValue({
      metadata: { marketplaceInstalled: true },
    } as never);
    vi.mocked(state.createConnector).mockImplementation(async () => {
      state.connectors = [{ id: 'connector-1', metadata: { avatar: 'icon' } }] as never;
      return { id: 'connector-1', isNew: false };
    });

    await install({ type: 'http', url: 'https://mcp.example.com' });

    expect(vi.mocked(state.createConnector).mock.calls[0][0].metadata).not.toHaveProperty(
      'marketplaceInstalled',
    );
    expect(vi.mocked(state.syncConnectorTools).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(state.updateConnector).mock.invocationCallOrder[0],
    );
    expect(state.updateConnector).toHaveBeenCalledWith('connector-1', {
      metadata: { avatar: 'icon', marketplaceInstalled: true },
    });
  });

  it('does not write the mark alone when the created row cannot be loaded', async () => {
    vi.mocked(state.createConnector).mockResolvedValue({ id: 'connector-1', isNew: true });

    await expect(install({ type: 'http', url: 'https://mcp.example.com' })).rejects.toThrow(
      'could not be loaded',
    );
    expect(state.updateConnector).not.toHaveBeenCalled();
    expect(state.deleteConnector).toHaveBeenCalledWith('connector-1');
  });

  it('keeps a connector that existed before the install when the sync fails', async () => {
    vi.mocked(state.createConnector).mockResolvedValue({ id: 'connector-1', isNew: false });
    vi.mocked(state.syncConnectorTools).mockRejectedValue(new Error('unreachable'));

    await expect(install({ type: 'http', url: 'https://down.example' })).rejects.toThrow();
    expect(state.deleteConnector).not.toHaveBeenCalled();
  });

  it('rolls back and leaves no mark when the install is canceled after the connector is created', async () => {
    const controller = new AbortController();
    vi.mocked(state.syncConnectorTools).mockImplementation(async () => controller.abort());

    await expect(
      installMarketplaceConnector(
        {
          connection: { type: 'http', url: 'https://mcp.example.com' },
          identifier: 'market-mcp',
          isOAuth: false,
          manifest,
          name: 'Market MCP',
          signal: controller.signal,
        },
        () => state,
      ),
    ).rejects.toThrow();
    expect(state.deleteConnector).toHaveBeenCalledWith('connector-1');
    expect(state.updateConnector).not.toHaveBeenCalled();
  });

  it('refuses to replace a connector the user added from another source', async () => {
    state.connectors = [
      {
        id: 'custom-1',
        identifier: 'market-mcp',
        mcpServerUrl: 'https://mine.example.com',
        metadata: null,
        sourceType: 'custom',
      },
    ] as never;

    await expect(install({ type: 'http', url: 'https://mcp.example.com' })).rejects.toThrow(
      'already exists',
    );
    expect(state.createConnector).not.toHaveBeenCalled();
    expect(state.deleteConnector).not.toHaveBeenCalled();
  });

  it('restores the connector it reinstalled over when the sync fails', async () => {
    state.connectors = [
      {
        id: 'connector-1',
        identifier: 'market-mcp',
        metadata: { marketplaceInstalled: true },
        sourceType: 'marketplace',
      },
    ] as never;
    vi.mocked(state.getConnectorForEdit).mockResolvedValue({
      credentials: { token: 'old-token', type: 'bearer' },
      id: 'connector-1',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://old.example',
      mcpStdioConfig: null,
      metadata: { avatar: 'old', marketplaceInstalled: true },
      name: 'Old MCP',
      oidcConfig: null,
      status: 'connected',
      tools: [
        {
          description: 'Search',
          inputSchema: { type: 'object' },
          metadata: { visibility: ['model'] },
          toolName: 'search',
        },
      ],
    } as never);
    vi.mocked(state.createConnector).mockResolvedValue({ id: 'connector-1', isNew: false });
    vi.mocked(state.syncConnectorTools).mockRejectedValue(new Error('unreachable'));

    await expect(install({ type: 'http', url: 'https://new.example' })).rejects.toThrow(
      'unreachable',
    );

    expect(state.deleteConnector).not.toHaveBeenCalled();
    expect(state.updateConnector).toHaveBeenCalledWith('connector-1', {
      credentials: { token: 'old-token', type: 'bearer' },
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://old.example',
      mcpStdioConfig: null,
      metadata: { avatar: 'old', marketplaceInstalled: true },
      name: 'Old MCP',
      oidcConfig: null,
    });
    expect(lambdaClient.connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
      id: 'connector-1',
      pruneMissingAutoTools: true,
      tools: [
        {
          description: 'Search',
          inputSchema: { type: 'object' },
          toolName: 'search',
          visibility: ['model'],
        },
      ],
    });
  });

  // `createConnector` resolves once the row is written, even when its list
  // refresh fails: the install refreshes again where a failure rolls back
  it('restores the connector it reinstalled over when the list refresh after the create fails', async () => {
    state.connectors = [
      {
        id: 'connector-1',
        identifier: 'market-mcp',
        mcpConnectionType: 'cloud',
        metadata: { marketplaceInstalled: true },
        sourceType: 'marketplace',
      },
    ] as never;
    vi.mocked(state.getConnectorForEdit).mockResolvedValue({
      credentials: null,
      id: 'connector-1',
      isEnabled: true,
      mcpConnectionType: 'cloud',
      mcpServerUrl: null,
      mcpStdioConfig: null,
      metadata: { cloudEndPoint: 'https://cloud.example', marketplaceInstalled: true },
      name: 'Old MCP',
      oidcConfig: null,
      status: 'disconnected',
      tools: [],
    } as never);
    vi.mocked(state.createConnector).mockResolvedValue({ id: 'connector-1', isNew: false });
    // The snapshot's own read succeeds; the refresh after the create does not
    vi.mocked(state.fetchConnectors)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network down'));

    await expect(install({ type: 'http', url: 'https://new.example' })).rejects.toThrow(
      'network down',
    );

    expect(state.syncConnectorTools).not.toHaveBeenCalled();
    expect(state.updateConnector).toHaveBeenCalledTimes(1);
    expect(state.updateConnector).toHaveBeenCalledWith(
      'connector-1',
      expect.objectContaining({
        mcpConnectionType: 'cloud',
        mcpServerUrl: null,
        metadata: { cloudEndPoint: 'https://cloud.example', marketplaceInstalled: true },
      }),
    );
  });

  it('puts a legacy tool projection back off the endpoint a failed reinstall wrote', async () => {
    state.connectors = [
      { id: 'connector-1', identifier: 'market-mcp', metadata: {}, sourceType: 'marketplace' },
    ] as never;
    vi.mocked(state.getConnectorForEdit).mockResolvedValue({
      credentials: null,
      id: 'connector-1',
      isEnabled: true,
      mcpConnectionType: null,
      mcpServerUrl: null,
      mcpStdioConfig: null,
      metadata: {},
      name: 'Legacy MCP',
      oidcConfig: null,
      status: 'connected',
      tools: [{ description: null, inputSchema: null, metadata: null, toolName: 'search' }],
    } as never);
    vi.mocked(state.createConnector).mockResolvedValue({ id: 'connector-1', isNew: false });
    vi.mocked(state.syncConnectorTools).mockRejectedValue(new Error('unreachable'));

    await expect(install({ type: 'http', url: 'https://new.example' })).rejects.toThrow(
      'unreachable',
    );

    expect(state.updateConnector).toHaveBeenCalledWith(
      'connector-1',
      expect.objectContaining({
        mcpConnectionType: null,
        mcpServerUrl: null,
        mcpStdioConfig: null,
      }),
    );
  });

  it('rolls back when the install is canceled while the mark is written', async () => {
    const controller = new AbortController();
    vi.mocked(state.updateConnector).mockImplementation(async () => controller.abort());

    await expect(
      installMarketplaceConnector(
        {
          connection: { type: 'http', url: 'https://mcp.example.com' },
          identifier: 'market-mcp',
          isOAuth: false,
          manifest,
          name: 'Market MCP',
          signal: controller.signal,
        },
        () => state,
      ),
    ).rejects.toThrow();
    expect(state.updateConnector).toHaveBeenCalled();
    expect(state.deleteConnector).toHaveBeenCalledWith('connector-1');
  });

  describe('an OAuth install canceled while the mark is written', () => {
    const cancelOAuth = (oauthReplaced?: unknown) => {
      const controller = new AbortController();
      state.connectors = [{ id: 'oauth-1', identifier: 'market-mcp', metadata: null }] as never;
      vi.mocked(state.updateConnector).mockImplementation(async () => controller.abort());

      return installMarketplaceConnector(
        {
          connection: { auth: { type: 'oauth2' }, type: 'http', url: 'https://mcp.example.com' },
          identifier: 'market-mcp',
          isOAuth: true,
          manifest,
          name: 'Market MCP',
          oauthReplaced: oauthReplaced as never,
          signal: controller.signal,
        },
        () => state,
      );
    };

    it('removes the connector its authorization created', async () => {
      await expect(cancelOAuth()).rejects.toThrow();

      expect(state.deleteConnector).toHaveBeenCalledWith('oauth-1');
    });

    it('restores the connector it authorized over, without the mark', async () => {
      const previous = {
        credentials: null,
        id: 'oauth-1',
        isEnabled: true,
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://old.example.com',
        mcpStdioConfig: null,
        metadata: { avatar: 'old' },
        name: 'Old MCP',
        oidcConfig: { scheme: 'dcr' },
        status: 'disconnected',
        tools: [],
      };

      await expect(cancelOAuth(previous)).rejects.toThrow();

      expect(state.deleteConnector).not.toHaveBeenCalled();
      // The mark write, then the restore of the previous row
      expect(state.updateConnector).toHaveBeenLastCalledWith(
        'oauth-1',
        expect.objectContaining({
          metadata: { avatar: 'old' },
          mcpServerUrl: 'https://old.example.com',
        }),
      );
    });
  });
});
