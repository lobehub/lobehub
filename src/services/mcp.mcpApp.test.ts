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
  environment: { isDesktop: true },
  ipcCall: vi.fn(),
  ipcRead: vi.fn(),
  plugins: new Map<string, unknown>(),
  relayCall: vi.fn(),
  relayRead: vi.fn(),
  // The tool store as the service reads it: plugins are visible once loaded.
  toolState: {
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

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ mcp: { callTool: ipcCall, readUiResource: ipcRead } }),
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
  environment.isDesktop = true;
  toolState.pluginsLoaded = true;
});

const view = { contents: [{ text: '<html />', uri: 'ui://app' }] };
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

    await expect(mcpService.readMcpAppResource('local', 'ui://app')).resolves.toEqual(view);

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

  it('loads the installed plugins first when the conversation was opened cold', async () => {
    plugins.set('remote', httpPlugin('https://mcp.example.com/mcp'));
    toolState.pluginsLoaded = false;

    await expect(mcpService.readMcpAppResource('remote', 'ui://app', 'agt_1')).resolves.toEqual(
      view,
    );

    expect(toolState.refreshPlugins).toHaveBeenCalledTimes(1);
    expect(connectorRead).not.toHaveBeenCalled();
    expect(relayRead).toHaveBeenCalledWith(expect.objectContaining({ uri: 'ui://app' }));
  });

  it('keeps public http servers on the server relay', async () => {
    plugins.set('remote', httpPlugin('https://mcp.example.com/mcp'));

    await expect(mcpService.readMcpAppResource('remote', 'ui://app')).resolves.toEqual(view);

    expect(ipcRead).not.toHaveBeenCalled();
    expect(relayRead).toHaveBeenCalledWith({
      params: expect.objectContaining({ headers: { 'x-key': 'k' } }),
      uri: 'ui://app',
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
    await expect(mcpService.readMcpAppResource('files', 'ui://app')).resolves.toEqual(view);

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

      await expect(mcpService.readMcpAppResource('files', 'ui://app')).resolves.toBeUndefined();
    }
    expect(ipcRead).not.toHaveBeenCalled();
  });

  it('falls back without a request off the desktop, where nothing can run the command', async () => {
    environment.isDesktop = false;

    await expect(mcpService.readMcpAppResource('files', 'ui://app')).resolves.toBeUndefined();

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

  it('lets the server resolve a connector only the agent owns', async () => {
    await expect(mcpService.readMcpAppResource('agent-app', 'ui://app', 'agt_1')).resolves.toEqual(
      view,
    );

    expect(connectorRead).toHaveBeenCalledWith({
      agentId: 'agt_1',
      identifier: 'agent-app',
      uri: 'ui://app',
    });
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
});

describe('mcpService.invokeMcpToolCall on desktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugins.clear();
    connectors.clear();
    ipcCall.mockResolvedValue(serializeMcpIpcPayload({ content: 'ok', success: true }));
  });

  const refresh = {
    apiName: 'refresh',
    arguments: '{"city":"Paris"}',
    id: 't1',
    identifier: 'local',
    type: 'mcp',
  } as const;

  it('calls localhost / LAN http servers over IPC for a view, not the server relay', async () => {
    plugins.set('local', httpPlugin('http://127.0.0.1:3000/mcp'));

    await mcpService.invokeMcpToolCall(refresh, { localHttpOverIpc: true });

    expect(relayCall).not.toHaveBeenCalled();
    expect(deserializeMcpIpcPayload(ipcCall.mock.calls[0][0])).toEqual({
      args: { city: 'Paris' },
      http: { headers: { 'x-key': 'k' }, name: 'local', url: 'http://127.0.0.1:3000/mcp' },
      toolName: 'refresh',
    });
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
