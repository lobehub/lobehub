import { type ChatToolPayload } from '@lobechat/types';
import superjson from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { discoverService } from './discover';
import { mcpService } from './mcp';

/**
 * Marketplace MCP servers used to run as plugins, and the Market was told about
 * each call: by the server for the calls it ran, by this client for the ones a
 * desktop ran itself. Installed as connectors, they are reported the same way.
 */

const environment = vi.hoisted(() => ({ isDesktop: true }));
const ipc = vi.hoisted(() => ({ callTool: vi.fn() }));
const toolState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const pluginLookup = vi.hoisted(() => ({
  getCustomPluginById: vi.fn(() => () => undefined as unknown),
  getInstalledPluginById: vi.fn(() => () => undefined as unknown),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  CURRENT_VERSION: '2.0.0',
  get isDesktop() {
    return environment.isDesktop;
  },
}));
vi.mock('@/store/serverConfig/store', () => ({
  getServerConfigStoreState: () => ({
    featureFlags: { enableMcpApps: false },
    serverConfig: { deviceGatewayConfigured: true },
  }),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: { callTool: { mutate: vi.fn() }, getForEdit: { query: vi.fn() } },
  },
  toolsClient: { mcp: { callTool: { mutate: vi.fn() } } },
}));
vi.mock('@/utils/electron/ipc', () => ({ ensureElectronIpc: () => ({ mcp: ipc }) }));
vi.mock('./discover', () => ({
  discoverService: {
    reportPluginCall: vi.fn().mockResolvedValue(undefined),
    safeInjectMPToken: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/store/tool/store', () => ({ getToolStoreState: () => toolState.current }));
vi.mock('@/store/tool/selectors', () => ({ pluginSelectors: pluginLookup }));

const payload = {
  apiName: 'read_file',
  arguments: '{"path":"a.txt"}',
  id: 'call-1',
  identifier: 'files-mcp',
  type: 'standalone',
} as ChatToolPayload;
const marketplace = {
  id: 'connector-id',
  identifier: 'files-mcp',
  isEnabled: true,
  mcpConnectionType: 'stdio',
  metadata: { marketplaceInstalled: true, version: '1.2.0' },
  sourceType: 'marketplace',
  status: 'connected',
};
const detail = {
  ...marketplace,
  mcpStdioConfig: { args: ['files-mcp'], command: 'npx' },
  tools: [{ permission: 'auto', toolName: 'read_file' }],
};
const localResult = {
  content: 'contents',
  state: { content: [{ text: 'contents', type: 'text' }] },
  success: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  environment.isDesktop = true;
  toolState.current = { connectors: [marketplace] };
  pluginLookup.getInstalledPluginById.mockReturnValue(() => undefined);
  vi.mocked(lambdaClient.connector.getForEdit.query).mockResolvedValue(detail as never);
  ipc.callTool.mockResolvedValue(superjson.serialize(localResult));
});

describe('Market call reports for connector calls', () => {
  it('reports a marketplace stdio call this desktop ran, with its session and version', async () => {
    await mcpService.invokeMcpToolCall(payload, { topicId: 'tpc_1' });

    expect(discoverService.reportPluginCall).toHaveBeenCalledTimes(1);
    expect(discoverService.reportPluginCall).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'files-mcp',
        isCustomPlugin: false,
        metadata: { appVersion: '2.0.0', command: 'npx', mcpType: 'stdio' },
        methodName: 'read_file',
        methodType: 'tool',
        responseSizeBytes: expect.any(Number),
        sessionId: 'tpc_1',
        success: true,
        version: '1.2.0',
      }),
    );
  });

  it('reports a failed local call as failed and still throws its error', async () => {
    ipc.callTool.mockRejectedValue(new Error('process exited'));

    await expect(mcpService.invokeMcpToolCall(payload, {})).rejects.toThrow('process exited');

    expect(discoverService.reportPluginCall).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'CALL_FAILED',
        errorMessage: 'process exited',
        responseSizeBytes: 0,
        success: false,
      }),
    );
  });

  it("does not report a custom connector's local call", async () => {
    const custom = {
      ...marketplace,
      metadata: { desktopStdioExecution: true },
      sourceType: 'custom',
    };
    toolState.current = { connectors: [custom] };
    vi.mocked(lambdaClient.connector.getForEdit.query).mockResolvedValue({
      ...detail,
      ...custom,
    } as never);

    await mcpService.invokeMcpToolCall(payload, {});

    expect(ipc.callTool).toHaveBeenCalled();
    expect(discoverService.reportPluginCall).not.toHaveBeenCalled();
  });

  // The connector route reports the calls the server runs
  it('sends the session to the connector route and reports nothing itself', async () => {
    environment.isDesktop = false;
    toolState.current = {
      connectors: [
        { ...marketplace, mcpConnectionType: 'http', mcpServerUrl: 'https://a.example' },
      ],
    };
    vi.mocked(lambdaClient.connector.callTool.mutate).mockResolvedValue(localResult as never);

    await mcpService.invokeMcpToolCall(payload, { topicId: 'tpc_1' });

    expect(lambdaClient.connector.callTool.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'files-mcp', topicId: 'tpc_1' }),
      expect.anything(),
    );
    expect(discoverService.reportPluginCall).not.toHaveBeenCalled();
  });
});

describe('Market call reports for plugin calls', () => {
  it('still reports a stdio plugin call this desktop ran', async () => {
    toolState.current = { connectors: [] };
    pluginLookup.getInstalledPluginById.mockReturnValue(() => ({
      customParams: { mcp: { args: ['files-mcp'], command: 'npx', type: 'stdio' } },
      identifier: 'files-mcp',
      manifest: { meta: { title: 'Files' }, version: '0.9.0' },
    }));

    await mcpService.invokeMcpToolCall(payload, { topicId: 'tpc_2' });

    expect(discoverService.reportPluginCall).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'files-mcp',
        isCustomPlugin: false,
        metadata: { appVersion: '2.0.0', command: 'npx', mcpType: 'stdio' },
        sessionId: 'tpc_2',
        success: true,
        version: '0.9.0',
      }),
    );
  });
});
