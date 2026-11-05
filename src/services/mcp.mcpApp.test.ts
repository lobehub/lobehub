import { getMcpServerFingerprint } from '@lobechat/const/mcpApp';
import { deserializeMcpIpcPayload, serializeMcpIpcPayload } from '@lobechat/utils/mcpIpcPayload';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpService } from './mcp';

const {
  connectorCall,
  connectorEdit,
  connectorRead,
  connectors,
  environment,
  ipcCall,
  ipcListTools,
  ipcRead,
  relayCall,
  relayRead,
  plugins,
  toolState,
} = vi.hoisted(() => ({
  connectorCall: vi.fn(),
  connectorEdit: vi.fn(),
  connectorRead: vi.fn(),
  connectors: new Map<string, unknown>(),
  environment: { deviceGatewayConfigured: false, isDesktop: true },
  ipcCall: vi.fn(),
  ipcListTools: vi.fn(),
  ipcRead: vi.fn(),
  plugins: new Map<string, unknown>(),
  relayCall: vi.fn(),
  relayRead: vi.fn(),
  // The tool store as the service reads it: plugins are visible once loaded.
  toolState: {
    ensureConfirmedConnectors: vi.fn(async (_agentId?: string) => {}),
    pluginsLoaded: true,
    refreshPlugins: vi.fn(async () => {
      toolState.pluginsLoaded = true;
    }),
  },
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  get isDesktop() {
    return environment.isDesktop;
  },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      callTool: { mutate: connectorCall },
      getForEdit: { query: connectorEdit },
      readUiResource: { query: connectorRead },
    },
  },
  // The relay read is a mutation only: plugin credentials must never go out in a GET URL
  toolsClient: { mcp: { callTool: { mutate: relayCall }, readUiResource: { mutate: relayRead } } },
}));

vi.mock('@/store/serverConfig/store', () => ({
  getServerConfigStoreState: () => ({
    featureFlags: { enableMcpApps: true },
    serverConfig: { deviceGatewayConfigured: environment.deviceGatewayConfigured },
  }),
}));

const { resolveGatewayDeviceId } = vi.hoisted(() => ({
  resolveGatewayDeviceId: vi.fn(async (): Promise<string | undefined> => 'this-desktop'),
}));

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ resolveGatewayDeviceId }),
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({
    mcp: { callTool: ipcCall, listTools: ipcListTools, readUiResource: ipcRead },
  }),
}));

vi.mock('./discover', () => ({
  discoverService: {
    reportPluginCall: vi.fn().mockResolvedValue(undefined),
    safeInjectMPToken: vi.fn(),
  },
}));

vi.mock('@/store/tool/store', () => ({ getToolStoreState: () => toolState }));

vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: {
    getCustomPluginById: () => () => undefined,
    getInstalledPluginById: (id: string) => () =>
      toolState.pluginsLoaded ? plugins.get(id) : undefined,
    isInstalledPluginsServerConfirmed: () => toolState.pluginsLoaded,
  },
}));

vi.mock('@/store/tool/slices/connector/selectors', () => ({
  connectorSelectors: {
    connectorByIdentifierForAgent: (id: string, agentId?: string) => () =>
      connectors.get(`${agentId}:${id}`),
  },
}));

// Each case runs on the desktop, with the plugins loaded, unless it says otherwise
beforeEach(() => {
  environment.deviceGatewayConfigured = false;
  environment.isDesktop = true;
  toolState.pluginsLoaded = true;
});

const view = { contents: [{ text: '<html />', uri: 'ui://app' }] };
// The servers the results in these cases came from
// `httpPlugin` sends the `x-key` header, which is part of which server it reaches
const LOCAL = await getMcpServerFingerprint({
  headers: { 'x-key': 'k' },
  type: 'http',
  url: 'http://127.0.0.1:3000/mcp',
});
const REMOTE = await getMcpServerFingerprint({
  headers: { 'x-key': 'k' },
  type: 'http',
  url: 'https://mcp.example.com/mcp',
});
const REMOTE_BARE = await getMcpServerFingerprint({
  type: 'http',
  url: 'https://mcp.example.com/mcp',
});
const STDIO = await getMcpServerFingerprint({
  args: ['mcp.js'],
  command: 'node',
  env: { TOKEN: 'fresh-secret' },
  type: 'stdio',
});
const LINEAR = await getMcpServerFingerprint({ type: 'http', url: 'https://mcp.linear.app/mcp' });
const httpPlugin = (url: string) => ({
  customParams: { mcp: { headers: { 'x-key': 'k' }, type: 'http', url } },
});

describe('mcpService.readMcpAppResource on desktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugins.clear();
    connectors.clear();
    ipcRead.mockResolvedValue(serializeMcpIpcPayload(view));
    relayRead.mockResolvedValue(view);
  });

  it('reads views of localhost / LAN http servers over IPC, not the server relay', async () => {
    plugins.set('local', httpPlugin('http://127.0.0.1:3000/mcp'));

    await expect(
      mcpService.readMcpAppResource('local', 'ui://app', { onThisDevice: true, server: LOCAL }),
    ).resolves.toEqual(view);

    expect(relayRead).not.toHaveBeenCalled();
    expect(deserializeMcpIpcPayload(ipcRead.mock.calls[0][0])).toEqual({
      http: {
        headers: { 'x-key': 'k' },
        name: 'local',
        url: 'http://127.0.0.1:3000/mcp',
      },
      uri: 'ui://app',
    });
  });

  it('reads a view of a LAN server on the server relay when the server produced its result', async () => {
    // A self-hosted server without a device gateway runs private http servers itself
    plugins.set('local', httpPlugin('http://127.0.0.1:3000/mcp'));

    await expect(
      mcpService.readMcpAppResource('local', 'ui://app', { server: LOCAL }),
    ).resolves.toEqual(view);

    expect(ipcRead).not.toHaveBeenCalled();
    expect(relayRead).toHaveBeenCalledWith(expect.objectContaining({ uri: 'ui://app' }));
  });

  it('reads no view once only the plugin headers changed, which may route to another server', async () => {
    plugins.set('remote', {
      customParams: {
        mcp: { headers: { 'x-key': 'other' }, type: 'http', url: 'https://mcp.example.com/mcp' },
      },
    });

    await expect(
      mcpService.readMcpAppResource('remote', 'ui://app', { server: REMOTE }),
    ).resolves.toBeUndefined();
    expect(relayRead).not.toHaveBeenCalled();
  });

  it("reads a server-run result's view with the runtime's params, which its fingerprint names", async () => {
    // The runtime ran it without the plugin settings this client merges into headers
    const runtime = { name: 'remote', type: 'http', url: 'https://mcp.example.com/mcp' };
    plugins.set('remote', {
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.com/mcp' } },
      manifest: { mcpParams: runtime },
      settings: { 'x-api-key': 'secret' },
    });

    await expect(
      mcpService.readMcpAppResource('remote', 'ui://app', { server: REMOTE_BARE }),
    ).resolves.toEqual(view);
    expect(relayRead).toHaveBeenCalledWith({ params: runtime, uri: 'ui://app' });
  });

  it('loads the installed plugins first when the conversation was opened cold', async () => {
    plugins.set('remote', httpPlugin('https://mcp.example.com/mcp'));
    toolState.pluginsLoaded = false;

    await expect(
      mcpService.readMcpAppResource('remote', 'ui://app', { agentId: 'agt_1', server: REMOTE }),
    ).resolves.toEqual(view);

    expect(toolState.refreshPlugins).toHaveBeenCalledTimes(1);
    expect(connectorRead).not.toHaveBeenCalled();
    expect(relayRead).toHaveBeenCalledWith(expect.objectContaining({ uri: 'ui://app' }));
  });

  it("loads the installed plugins in a cold conversation when only the plugin's tool row is", async () => {
    plugins.set('remote', httpPlugin('https://mcp.example.com/mcp'));
    // The endpoint-less row a plugin's tools sync to, loaded before the plugins
    connectors.set('agt_1:remote', { id: 'conn_1', identifier: 'remote', isEnabled: true });
    toolState.pluginsLoaded = false;

    await expect(
      mcpService.readMcpAppResource('remote', 'ui://app', { agentId: 'agt_1', server: REMOTE }),
    ).resolves.toEqual(view);

    expect(toolState.refreshPlugins).toHaveBeenCalledTimes(1);
    expect(connectorRead).not.toHaveBeenCalled();
    expect(relayRead).toHaveBeenCalledWith(expect.objectContaining({ uri: 'ui://app' }));
  });

  it("reads a headerless plugin's view with the runtime's params, so on its session", async () => {
    plugins.set('remote', {
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.com/mcp' } },
    });

    await mcpService.readMcpAppResource('remote', 'ui://app', { server: REMOTE_BARE });

    // The runtime's manifest params carry no `headers` key, and sessions are keyed by params
    expect(relayRead.mock.calls[0][0].params).not.toHaveProperty('headers');
  });

  it('keeps public http servers on the server relay', async () => {
    plugins.set('remote', httpPlugin('https://mcp.example.com/mcp'));

    await expect(
      mcpService.readMcpAppResource('remote', 'ui://app', { server: REMOTE }),
    ).resolves.toEqual(view);

    expect(ipcRead).not.toHaveBeenCalled();
    expect(relayRead).toHaveBeenCalledWith({
      params: expect.objectContaining({ headers: { 'x-key': 'k' } }),
      uri: 'ui://app',
    });
  });
});

describe('mcpService tool discovery on desktop with MCP Apps on', () => {
  it("lists a local server's tools on a session that announces MCP Apps", async () => {
    // A server may list the tools only its views call just to such a client
    ipcListTools.mockResolvedValue(serializeMcpIpcPayload([]));

    await mcpService.listLocalMcpTools({ stdio: { command: 'dash-mcp', name: 'dash' } });

    expect(deserializeMcpIpcPayload(ipcListTools.mock.calls[0][0])).toMatchObject({
      mcpApps: true,
    });
  });
});

describe('mcpService.readMcpAppResource for stdio connectors', () => {
  const stdioConnector = {
    id: 'conn_1',
    identifier: 'files',
    isEnabled: true,
    mcpConnectionType: 'stdio',
  };
  const detail = {
    ...stdioConnector,
    mcpStdioConfig: { args: ['mcp.js'], command: 'node', env: { TOKEN: 'fresh-secret' } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugins.clear();
    connectors.clear();
    connectors.set('undefined:files', stdioConnector);
    connectorEdit.mockResolvedValue(detail);
    ipcRead.mockResolvedValue(serializeMcpIpcPayload(view));
  });

  it('reads the view on the desktop with the fresh stdio configuration', async () => {
    await expect(
      mcpService.readMcpAppResource('files', 'ui://app', { onThisDevice: true, server: STDIO }),
    ).resolves.toEqual(view);

    expect(connectorEdit).toHaveBeenCalledWith({ id: 'conn_1' });
    expect(deserializeMcpIpcPayload(ipcRead.mock.calls[0][0])).toEqual({
      env: { TOKEN: 'fresh-secret' },
      params: { args: ['mcp.js'], command: 'node', name: 'files', type: 'stdio' },
      uri: 'ui://app',
    });
    expect(connectorRead).not.toHaveBeenCalled();
  });

  it('does not read once the connector is disabled or loses its command', async () => {
    for (const current of [
      { ...detail, isEnabled: false },
      { ...detail, mcpStdioConfig: undefined },
    ]) {
      connectorEdit.mockResolvedValueOnce(current);

      await expect(
        mcpService.readMcpAppResource('files', 'ui://app', { onThisDevice: true, server: STDIO }),
      ).resolves.toBeUndefined();
    }
    expect(ipcRead).not.toHaveBeenCalled();
  });

  it("loads the agent's own stdio connector in a cold conversation before choosing the route", async () => {
    connectors.clear();
    // Only known once the agent's tools are loaded
    toolState.ensureConfirmedConnectors.mockImplementationOnce(async (agentId?: string) => {
      connectors.set(`${agentId}:files`, stdioConnector);
    });

    await expect(
      mcpService.readMcpAppResource('files', 'ui://app', {
        agentId: 'agt_1',
        onThisDevice: true,
        server: STDIO,
      }),
    ).resolves.toEqual(view);

    expect(toolState.ensureConfirmedConnectors).toHaveBeenCalledWith('agt_1');
    expect(connectorRead).not.toHaveBeenCalled();
    expect(deserializeMcpIpcPayload(ipcRead.mock.calls[0][0])).toMatchObject({
      params: { command: 'node', name: 'files', type: 'stdio' },
    });
  });

  it("fails the read, so it is retried, when the agent's own connectors can't be loaded", async () => {
    // The base connector of the same identifier is loaded; the agent's own copy is not
    connectors.set('agt_1:files', stdioConnector);
    toolState.ensureConfirmedConnectors.mockRejectedValueOnce(new Error('offline'));

    await expect(
      mcpService.readMcpAppResource('files', 'ui://app', {
        agentId: 'agt_1',
        onThisDevice: true,
        server: STDIO,
      }),
    ).rejects.toThrow('offline');

    // Never read from the base connector meanwhile
    expect(connectorEdit).not.toHaveBeenCalled();
    expect(ipcRead).not.toHaveBeenCalled();
    expect(connectorRead).not.toHaveBeenCalled();
    expect(relayRead).not.toHaveBeenCalled();
  });

  it('reads no view once the connector runs another command than the one that produced it', async () => {
    connectorEdit.mockResolvedValueOnce({
      ...detail,
      mcpStdioConfig: { args: ['other.js'], command: 'node', env: {} },
    });

    await expect(
      mcpService.readMcpAppResource('files', 'ui://app', { onThisDevice: true, server: STDIO }),
    ).resolves.toBeUndefined();
    expect(ipcRead).not.toHaveBeenCalled();
  });

  it('reads no view once only the connector environment changed, which may pick another server', async () => {
    connectorEdit.mockResolvedValueOnce({
      ...detail,
      mcpStdioConfig: { ...detail.mcpStdioConfig, env: { TOKEN: 'fresh-secret', URL: 'b' } },
    });

    await expect(
      mcpService.readMcpAppResource('files', 'ui://app', { onThisDevice: true, server: STDIO }),
    ).resolves.toBeUndefined();
    expect(ipcRead).not.toHaveBeenCalled();
  });

  it('falls back without a request off the desktop, where nothing can run the command', async () => {
    environment.isDesktop = false;

    await expect(
      mcpService.readMcpAppResource('files', 'ui://app', { onThisDevice: true, server: STDIO }),
    ).resolves.toBeUndefined();

    expect(connectorEdit).not.toHaveBeenCalled();
    expect(connectorRead).not.toHaveBeenCalled();
    expect(ipcRead).not.toHaveBeenCalled();
  });
});

describe('mcpService MCP App calls for agents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugins.clear();
    connectors.clear();
    connectorRead.mockResolvedValue(view);
    connectorCall.mockResolvedValue({ content: 'ok', success: true });
  });

  it("reads an agent's connector view on the server, which checks the result's server", async () => {
    connectors.set('agt_1:agent-app', {
      isEnabled: true,
      mcpServerUrl: 'https://mcp.example.com/mcp',
    });

    await expect(
      mcpService.readMcpAppResource('agent-app', 'ui://app', { agentId: 'agt_1', server: REMOTE }),
    ).resolves.toEqual(view);

    expect(connectorRead).toHaveBeenCalledWith({
      agentId: 'agt_1',
      identifier: 'agent-app',
      server: REMOTE,
      uri: 'ui://app',
    });
  });

  it('reads no view for a result that came from another server than the identifier reaches now', async () => {
    // The connector that produced it was disabled; a plugin of the same identifier remains
    connectors.set('agt_1:shared', {
      isEnabled: false,
      mcpServerUrl: 'https://mcp.example.com/mcp',
    });
    plugins.set('shared', httpPlugin('https://other.example.com/mcp'));

    await expect(
      mcpService.readMcpAppResource('shared', 'ui://app', { agentId: 'agt_1', server: REMOTE }),
    ).resolves.toBeUndefined();
    // Nor for a result that names no server
    await expect(
      mcpService.readMcpAppResource('shared', 'ui://app', { agentId: 'agt_1' }),
    ).resolves.toBeUndefined();

    expect(relayRead).not.toHaveBeenCalled();
    expect(ipcRead).not.toHaveBeenCalled();
    expect(connectorRead).not.toHaveBeenCalled();
  });

  it('sends the agent with connector tool calls', async () => {
    connectors.set('agt_1:linear', {
      isEnabled: true,
      mcpServerUrl: 'https://mcp.linear.app/mcp',
    });

    await mcpService.invokeMcpToolCall(
      { apiName: 'list', arguments: '{}', id: 't1', identifier: 'linear', type: 'mcp' },
      { agentId: 'agt_1' },
    );

    expect(connectorCall).toHaveBeenCalledWith(
      { agentId: 'agt_1', args: '{}', identifier: 'linear', toolName: 'list' },
      expect.anything(),
    );
  });

  it("marks a view's connector call so the server checks the tool's visibility", async () => {
    connectors.set('agt_1:linear', {
      isEnabled: true,
      mcpServerUrl: 'https://mcp.linear.app/mcp',
    });

    await mcpService.invokeMcpToolCall(
      { apiName: 'list', arguments: '{}', id: 't1', identifier: 'linear', type: 'mcp' },
      { agentId: 'agt_1', fromMcpApp: true, server: LINEAR },
    );

    expect(connectorCall).toHaveBeenCalledWith(
      {
        agentId: 'agt_1',
        args: '{}',
        fromApp: true,
        identifier: 'linear',
        server: LINEAR,
        toolName: 'list',
      },
      expect.anything(),
    );
  });
});

describe('mcpService.invokeMcpToolCall on desktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugins.clear();
    connectors.clear();
    ipcCall.mockResolvedValue(serializeMcpIpcPayload({ content: 'ok', success: true }));
  });

  // A view whose result this desktop's own MCP process produced
  const localView = { fromMcpApp: true, onThisDevice: true, server: LOCAL };
  const refresh = {
    apiName: 'refresh',
    arguments: '{"city":"Paris"}',
    id: 't1',
    identifier: 'local',
    type: 'mcp',
  } as const;

  it('calls localhost / LAN http servers over IPC for a view, not the server relay', async () => {
    plugins.set('local', httpPlugin('http://127.0.0.1:3000/mcp'));

    await mcpService.invokeMcpToolCall(refresh, localView);

    expect(relayCall).not.toHaveBeenCalled();
    expect(deserializeMcpIpcPayload(ipcCall.mock.calls[0][0])).toEqual({
      args: { city: 'Paris' },
      fromApp: true,
      http: { headers: { 'x-key': 'k' }, name: 'local', url: 'http://127.0.0.1:3000/mcp' },
      mcpApps: true,
      toolName: 'refresh',
    });
  });

  it("marks a view's relay call so the server checks the tool's visibility", async () => {
    plugins.set('remote', httpPlugin('https://mcp.example.com/mcp'));
    relayCall.mockResolvedValue({ content: 'ok', success: true });

    await mcpService.invokeMcpToolCall(
      { ...refresh, identifier: 'remote' },
      { fromMcpApp: true, server: REMOTE },
    );

    expect(relayCall).toHaveBeenCalledWith(
      expect.objectContaining({ fromApp: true, toolName: 'refresh' }),
      expect.anything(),
    );
  });

  it('refuses a view call once the plugin reaches another server than the view came from', async () => {
    plugins.set('local', httpPlugin('http://127.0.0.1:4000/mcp'));

    await expect(mcpService.invokeMcpToolCall(refresh, localView)).rejects.toThrow(
      'another server',
    );
    expect(ipcCall).not.toHaveBeenCalled();
    expect(relayCall).not.toHaveBeenCalled();
  });

  it('runs a view call to a LAN server on the server relay when the server produced its result', async () => {
    plugins.set('local', httpPlugin('http://127.0.0.1:3000/mcp'));
    relayCall.mockResolvedValue({ content: 'ok', success: true });

    await mcpService.invokeMcpToolCall(refresh, { fromMcpApp: true, server: LOCAL });

    expect(ipcCall).not.toHaveBeenCalled();
    expect(relayCall).toHaveBeenCalledWith(
      expect.objectContaining({ fromApp: true, toolName: 'refresh' }),
      expect.anything(),
    );
  });

  it('refuses a view call to a cloud server, whose gateway cannot check visibility', async () => {
    plugins.set('cloud', { customParams: { mcp: { type: 'cloud' } } });

    await expect(
      mcpService.invokeMcpToolCall({ ...refresh, identifier: 'cloud' }, { fromMcpApp: true }),
    ).rejects.toThrow("can't be called from an interactive view");
    expect(relayCall).not.toHaveBeenCalled();
  });

  it('does not dispatch a cancelled view call over IPC', async () => {
    plugins.set('local', httpPlugin('http://127.0.0.1:3000/mcp'));
    const request = new AbortController();
    request.abort();

    await expect(
      mcpService.invokeMcpToolCall(refresh, { ...localView, signal: request.signal }),
    ).rejects.toThrow();
    expect(ipcCall).not.toHaveBeenCalled();
  });

  it('records this desktop on a view its local MCP process marked', async () => {
    plugins.set('local', httpPlugin('http://127.0.0.1:3000/mcp'));
    ipcCall.mockResolvedValueOnce(
      serializeMcpIpcPayload({
        content: 'ok',
        state: { content: [], mcpApp: { resourceUri: 'ui://dash/view' } },
        success: true,
      }),
    );

    const result = await mcpService.invokeMcpToolCall(refresh, localView);

    // Only this desktop can serve it: the view and its calls run in its process
    expect(result?.state?.mcpApp).toEqual({
      deviceId: 'this-desktop',
      resourceUri: 'ui://dash/view',
    });
  });

  it("offers no view when this desktop's id can't be resolved", async () => {
    plugins.set('local', httpPlugin('http://127.0.0.1:3000/mcp'));
    resolveGatewayDeviceId.mockResolvedValueOnce(undefined);
    ipcCall.mockResolvedValueOnce(
      serializeMcpIpcPayload({
        content: 'ok',
        state: { content: [], mcpApp: { resourceUri: 'ui://dash/view' } },
        success: true,
      }),
    );

    const result = await mcpService.invokeMcpToolCall(refresh, localView);

    // Unmarked, any desktop opening the conversation would serve it
    expect(result?.state).toEqual({ content: [] });
  });

  it('keeps conversation calls to localhost / LAN http servers on their existing route', async () => {
    plugins.set('local', httpPlugin('http://127.0.0.1:3000/mcp'));
    relayCall.mockResolvedValue({ content: 'ok', success: true });

    await mcpService.invokeMcpToolCall(refresh, {});

    expect(ipcCall).not.toHaveBeenCalled();
    expect(relayCall).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'refresh' }),
      expect.anything(),
    );
  });
});

describe('mcpService.invokeMcpToolCall for stdio connectors behind a device gateway', () => {
  const stdioConnector = {
    id: 'conn_1',
    identifier: 'files',
    isEnabled: true,
    mcpConnectionType: 'stdio',
  };
  const detail = {
    ...stdioConnector,
    mcpConnectionType: 'stdio',
    mcpStdioConfig: { args: ['mcp.js'], command: 'node', env: { TOKEN: 'fresh-secret' } },
    tools: [{ permission: 'auto', toolName: 'list' }],
  };
  const stdioView = { fromMcpApp: true, onThisDevice: true, server: STDIO };
  const list = {
    apiName: 'list',
    arguments: '{"dir":"/tmp"}',
    id: 't1',
    identifier: 'files',
    type: 'mcp',
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    plugins.clear();
    connectors.clear();
    connectors.set('undefined:files', stdioConnector);
    environment.deviceGatewayConfigured = true;
    connectorEdit.mockResolvedValue(detail);
    connectorCall.mockResolvedValue({ content: 'server', success: true });
    ipcCall.mockResolvedValue(serializeMcpIpcPayload({ content: 'ok', success: true }));
  });

  it('runs a view call on this desktop, where its view was read', async () => {
    await expect(mcpService.invokeMcpToolCall(list, stdioView)).resolves.toEqual({
      content: 'ok',
      success: true,
    });

    expect(connectorCall).not.toHaveBeenCalled();
    expect(deserializeMcpIpcPayload(ipcCall.mock.calls[0][0])).toEqual({
      args: { dir: '/tmp' },
      env: { TOKEN: 'fresh-secret' },
      fromApp: true,
      mcpApps: true,
      params: { args: ['mcp.js'], command: 'node', name: 'files', type: 'stdio' },
      toolName: 'list',
    });
  });

  it('does not dispatch a view call cancelled while its connector was read', async () => {
    const request = new AbortController();
    connectorEdit.mockImplementation(async () => {
      request.abort();
      return detail;
    });

    await expect(
      mcpService.invokeMcpToolCall(list, { ...stdioView, signal: request.signal }),
    ).rejects.toThrow();
    expect(ipcCall).not.toHaveBeenCalled();
  });

  it('still refuses a view call to a tool the connector disabled', async () => {
    connectorEdit.mockResolvedValue({
      ...detail,
      tools: [{ permission: 'disabled', toolName: 'list' }],
    });

    await expect(mcpService.invokeMcpToolCall(list, stdioView)).rejects.toThrow(
      'unavailable or disabled',
    );
    expect(ipcCall).not.toHaveBeenCalled();
  });

  it('keeps conversation calls on the gateway route', async () => {
    await mcpService.invokeMcpToolCall(list, {});

    expect(ipcCall).not.toHaveBeenCalled();
    expect(connectorCall).toHaveBeenCalledWith(
      { agentId: undefined, args: '{"dir":"/tmp"}', identifier: 'files', toolName: 'list' },
      expect.anything(),
    );
  });
});
