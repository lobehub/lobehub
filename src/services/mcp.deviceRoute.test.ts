import { type ChatToolPayload } from '@lobechat/types';
import superjson from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpService } from './mcp';

// Where an HTTP MCP server is reached from: a server only the user's machine
// reaches (a localhost / LAN address, or one set to connect through the device)
// is read and called over Desktop IPC, and on the web through the device
// gateway; any other through the server relay.

const mockElectronIpc = {
  mcp: {
    callTool: vi.fn(),
    getStreamableMcpServerManifest: vi.fn(),
  },
};

const environment = vi.hoisted(() => ({ isDesktop: false }));

vi.mock('@/store/serverConfig/store', () => ({
  getServerConfigStoreState: () => ({
    featureFlags: { enableMcpApps: false },
    serverConfig: { deviceGatewayConfigured: true },
  }),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  CURRENT_VERSION: '1.0.0',
  get isDesktop() {
    return environment.isDesktop;
  },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      callTool: { mutate: vi.fn() },
      getDeviceMcpManifest: { mutate: vi.fn() },
      getForRun: { query: vi.fn() },
      getLocalCallToken: { mutate: vi.fn() },
    },
  },
  toolsClient: {
    mcp: {
      callTool: { mutate: vi.fn() },
      getStreamableMcpServerManifest: { query: vi.fn() },
    },
  },
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => mockElectronIpc,
}));

vi.mock('./discover', () => ({
  discoverService: {
    reportPluginCall: vi.fn().mockResolvedValue(undefined),
    safeInjectMPToken: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockGetToolStoreState = vi.fn();
const mockPluginSelectors = {
  getCustomPluginById: vi.fn(),
  getInstalledPluginById: vi.fn(),
};

vi.mock('@/store/tool/store', () => ({
  getToolStoreState: () => mockGetToolStoreState(),
}));

vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: mockPluginSelectors,
}));

const TAILNET_URL = 'https://nas.tail1234.ts.net/mcp';
const manifest = {
  api: [],
  identifier: 'nas',
  mcpParams: { name: 'nas', type: 'http', url: TAILNET_URL },
  meta: { title: 'NAS' },
  version: '1',
};

beforeEach(() => {
  vi.clearAllMocks();
  environment.isDesktop = false;
  mockGetToolStoreState.mockReturnValue({});
  mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => undefined);
  mockPluginSelectors.getCustomPluginById.mockReturnValue(() => undefined);
  mockElectronIpc.mcp.getStreamableMcpServerManifest.mockResolvedValue(
    superjson.serialize(manifest),
  );
  mockElectronIpc.mcp.callTool.mockResolvedValue(
    superjson.serialize({ content: 'ok', success: true }),
  );
});

describe('getStreamableMcpServerManifest routing', () => {
  const ipcPayload = () =>
    superjson.deserialize(
      mockElectronIpc.mcp.getStreamableMcpServerManifest.mock.calls[0][0],
    ) as Record<string, unknown>;

  it('reads a public-looking server set to connect through the device over IPC on desktop', async () => {
    const { lambdaClient, toolsClient } = await import('@/libs/trpc/client');
    environment.isDesktop = true;

    const result = await mcpService.getStreamableMcpServerManifest({
      auth: { type: 'none' },
      connectVia: 'device',
      identifier: 'nas',
      url: TAILNET_URL,
    });

    // Server-side agent runs route by the persisted `mcpParams`: the choice stays
    expect(result).toEqual({
      ...manifest,
      mcpParams: { ...manifest.mcpParams, connectVia: 'device' },
    });
    expect(ipcPayload()).toMatchObject({ identifier: 'nas', url: TAILNET_URL });
    // The routing choice is not a connection parameter
    expect(ipcPayload()).not.toHaveProperty('connectVia');
    expect(toolsClient.mcp.getStreamableMcpServerManifest.query).not.toHaveBeenCalled();
    expect(lambdaClient.connector.getDeviceMcpManifest.mutate).not.toHaveBeenCalled();
  });

  it('reads a localhost server over IPC on desktop without any setting', async () => {
    const { toolsClient } = await import('@/libs/trpc/client');
    environment.isDesktop = true;

    await mcpService.getStreamableMcpServerManifest({
      identifier: 'local',
      url: 'http://127.0.0.1:3000/mcp',
    });

    expect(mockElectronIpc.mcp.getStreamableMcpServerManifest).toHaveBeenCalledOnce();
    expect(toolsClient.mcp.getStreamableMcpServerManifest.query).not.toHaveBeenCalled();
  });

  it('keeps a public server on automatic routing on the server relay on desktop', async () => {
    const { toolsClient } = await import('@/libs/trpc/client');
    environment.isDesktop = true;

    await mcpService.getStreamableMcpServerManifest({
      connectVia: 'auto',
      identifier: 'nas',
      url: TAILNET_URL,
    });

    expect(mockElectronIpc.mcp.getStreamableMcpServerManifest).not.toHaveBeenCalled();
    expect(toolsClient.mcp.getStreamableMcpServerManifest.query).toHaveBeenCalledWith(
      { identifier: 'nas', url: TAILNET_URL },
      { signal: undefined },
    );
  });

  it('reads a server set to connect through the device via the device gateway on the web', async () => {
    const { lambdaClient, toolsClient } = await import('@/libs/trpc/client');
    vi.mocked(lambdaClient.connector.getDeviceMcpManifest.mutate).mockResolvedValue(
      manifest as never,
    );
    const signal = new AbortController().signal;

    const result = await mcpService.getStreamableMcpServerManifest(
      {
        auth: { token: 'secret', type: 'bearer' },
        connectVia: 'device',
        identifier: 'nas',
        url: TAILNET_URL,
      },
      signal,
    );

    expect(result).toEqual(manifest);
    expect(lambdaClient.connector.getDeviceMcpManifest.mutate).toHaveBeenCalledWith(
      { auth: { token: 'secret', type: 'bearer' }, identifier: 'nas', url: TAILNET_URL },
      { signal },
    );
    expect(toolsClient.mcp.getStreamableMcpServerManifest.query).not.toHaveBeenCalled();
    expect(mockElectronIpc.mcp.getStreamableMcpServerManifest).not.toHaveBeenCalled();
  });
});

describe('invokeMcpToolCall routing for HTTP servers', () => {
  const payload = { apiName: 'list_files', arguments: '{"dir":"/"}', identifier: 'nas' };

  describe('a plugin', () => {
    const usePlugin = (mcp: Record<string, unknown>) =>
      mockPluginSelectors.getCustomPluginById.mockReturnValue(() => ({
        customParams: { mcp: { type: 'http', url: TAILNET_URL, ...mcp } },
        identifier: 'nas',
        manifest: { meta: { title: 'NAS' }, version: '1' },
      }));

    it('calls a server set to connect through the device over IPC on desktop', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');
      environment.isDesktop = true;
      usePlugin({ connectVia: 'device' });

      await mcpService.invokeMcpToolCall(payload as ChatToolPayload, {});

      const sent = superjson.deserialize(mockElectronIpc.mcp.callTool.mock.calls[0][0]);
      expect(sent).toMatchObject({
        args: { dir: '/' },
        http: { name: 'nas', url: TAILNET_URL },
        toolName: 'list_files',
      });
      expect(toolsClient.mcp.callTool.mutate).not.toHaveBeenCalled();
    });

    it('calls the same server on automatic routing through the server relay', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');
      environment.isDesktop = true;
      usePlugin({});
      vi.mocked(toolsClient.mcp.callTool.mutate).mockResolvedValue({ content: 'ok' } as never);

      await mcpService.invokeMcpToolCall(payload as ChatToolPayload, {});

      expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
      expect(toolsClient.mcp.callTool.mutate).toHaveBeenCalledOnce();
    });
  });

  describe('a connector', () => {
    const connector = {
      id: 'nas-id',
      identifier: 'nas',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: TAILNET_URL,
    };
    const useConnector = (metadata: Record<string, unknown>) => {
      mockGetToolStoreState.mockReturnValue({ connectors: [{ ...connector, metadata }] });
    };

    it('calls one set to connect through the device over IPC on desktop with fresh config', async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      environment.isDesktop = true;
      useConnector({ connectVia: 'device' });
      vi.mocked(lambdaClient.connector.getForRun.query).mockResolvedValue({
        ...connector,
        metadata: { connectVia: 'device' },
        tools: [{ permission: 'auto', toolName: 'list_files' }],
      } as never);

      await mcpService.invokeMcpToolCall(payload as ChatToolPayload, {});

      expect(lambdaClient.connector.getForRun.query).toHaveBeenCalledWith({
        agentId: undefined,
        identifier: 'nas',
        topicId: undefined,
      });
      const sent = superjson.deserialize(mockElectronIpc.mcp.callTool.mock.calls[0][0]);
      expect(sent).toMatchObject({
        args: { dir: '/' },
        http: { url: TAILNET_URL },
        toolName: 'list_files',
      });
      expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
    });

    // `getForRun` leaves OAuth tokens out; the call fetches the current one
    it("sends an OAuth connector's access token with a call it runs over IPC", async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      environment.isDesktop = true;
      useConnector({ connectVia: 'device' });
      vi.mocked(lambdaClient.connector.getForRun.query).mockResolvedValue({
        ...connector,
        credentials: null,
        metadata: { connectVia: 'device' },
        oidcConfig: { clientId: 'cid', issuer: 'https://auth.example.com' },
        tools: [{ permission: 'auto', toolName: 'list_files' }],
      } as never);
      vi.mocked(lambdaClient.connector.getLocalCallToken.mutate).mockResolvedValue({
        accessToken: 'fresh-access',
        type: 'oauth2',
      } as never);

      await mcpService.invokeMcpToolCall(payload as ChatToolPayload, {});

      expect(lambdaClient.connector.getLocalCallToken.mutate).toHaveBeenCalledWith({
        id: 'nas-id',
        run: { agentId: undefined, identifier: 'nas', topicId: undefined },
      });
      const sent = superjson.deserialize(mockElectronIpc.mcp.callTool.mock.calls[0][0]);
      expect(sent).toMatchObject({
        http: { auth: { accessToken: 'fresh-access', type: 'oauth2' }, url: TAILNET_URL },
      });
    });

    // The selector names the account whose token goes out; the server never sees it
    it("sends the selected account's token and strips the selector for a connector holding several", async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      environment.isDesktop = true;
      mockGetToolStoreState.mockReturnValue({
        connectors: [
          {
            ...connector,
            links: [
              { id: 'lnk_a', name: 'Alice' },
              { id: 'lnk_b', name: 'Bob' },
            ],
            metadata: { connectVia: 'device' },
          },
        ],
      });
      vi.mocked(lambdaClient.connector.getForRun.query).mockResolvedValue({
        ...connector,
        credentials: null,
        metadata: { connectVia: 'device' },
        oidcConfig: { clientId: 'cid', issuer: 'https://auth.example.com' },
        tools: [
          { inputSchema: { properties: { dir: {} } }, permission: 'auto', toolName: 'list_files' },
        ],
      } as never);
      vi.mocked(lambdaClient.connector.getLocalCallToken.mutate).mockResolvedValue({
        accessToken: 'bob-access',
        type: 'oauth2',
      } as never);

      await mcpService.invokeMcpToolCall(
        { ...payload, arguments: '{"dir":"/","link_id":"lnk_b"}' } as ChatToolPayload,
        {},
      );

      expect(lambdaClient.connector.getLocalCallToken.mutate).toHaveBeenCalledWith({
        id: 'nas-id',
        linkId: 'lnk_b',
        run: { agentId: undefined, identifier: 'nas', topicId: undefined },
      });
      const sent = superjson.deserialize(mockElectronIpc.mcp.callTool.mock.calls[0][0]);
      expect(sent).toMatchObject({
        args: { dir: '/' },
        http: { auth: { accessToken: 'bob-access', type: 'oauth2' } },
      });
      expect((sent as { args: Record<string, unknown> }).args).not.toHaveProperty('link_id');

      await expect(mcpService.invokeMcpToolCall(payload as ChatToolPayload, {})).rejects.toThrow(
        'link_id is required',
      );
    });

    it('leaves one set to connect through the device to the server on the web', async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      useConnector({ connectVia: 'device' });
      vi.mocked(lambdaClient.connector.callTool.mutate).mockResolvedValue({
        content: 'ok',
        success: true,
      } as never);

      await mcpService.invokeMcpToolCall(payload as ChatToolPayload, {});

      // The server tunnels it to the user's desktop through the device gateway
      expect(lambdaClient.connector.callTool.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'nas', toolName: 'list_files' }),
        expect.anything(),
      );
      expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
    });

    it('leaves one on automatic routing to the server on desktop', async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      environment.isDesktop = true;
      useConnector({});
      vi.mocked(lambdaClient.connector.callTool.mutate).mockResolvedValue({
        content: 'ok',
        success: true,
      } as never);

      await mcpService.invokeMcpToolCall(payload as ChatToolPayload, {});

      expect(lambdaClient.connector.callTool.mutate).toHaveBeenCalledOnce();
      expect(lambdaClient.connector.getForRun.query).not.toHaveBeenCalled();
      expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
    });
  });
});
