import { type ChatToolPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpService } from './mcp';

// A view relayed from a device (`mcpApp.relayDeviceId`): the device ran the
// tool, and the server reads its view and runs its calls back there, so every
// client renders it the same way: through the server, never over this
// desktop's own IPC, wherever the connector would otherwise run.

const environment = vi.hoisted(() => ({ isDesktop: true }));
const mockElectronIpc = { mcp: { callTool: vi.fn(), readUiResource: vi.fn() } };
const runConnector = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  CURRENT_VERSION: '1.0.0',
  get isDesktop() {
    return environment.isDesktop;
  },
}));
vi.mock('@/store/serverConfig/store', () => ({
  getServerConfigStoreState: () => ({
    featureFlags: { enableMcpApps: true },
    serverConfig: { deviceGatewayConfigured: true },
  }),
}));
vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: { enableMcpApps: () => true },
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      callTool: { mutate: vi.fn() },
      getForRun: { query: vi.fn() },
      readUiResource: { query: vi.fn() },
    },
  },
  toolsClient: { mcp: { callTool: { mutate: vi.fn() }, readUiResource: { mutate: vi.fn() } } },
}));
vi.mock('@/utils/electron/ipc', () => ({ ensureElectronIpc: () => mockElectronIpc }));
vi.mock('./discover', () => ({
  discoverService: {
    reportPluginCall: vi.fn().mockResolvedValue(undefined),
    safeInjectMPToken: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('./connectorRun', () => ({ resolveRunConnector: runConnector }));
vi.mock('@/store/tool/store', () => ({
  getToolStoreState: () => ({
    ensureConfirmedConnectors: async () => {},
    refreshPlugins: async () => {},
  }),
}));
vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: {
    getCustomPluginById: () => () => undefined,
    getInstalledPluginById: () => () => undefined,
    isInstalledPluginsServerConfirmed: () => true,
  },
}));

// An unbound stdio connector: a desktop would otherwise run a view's call over IPC
const stdioConnector = {
  id: 'poki-id',
  identifier: 'poki',
  isEnabled: true,
  mcpConnectionType: 'stdio',
  mcpServerUrl: null,
  metadata: null,
  status: 'connected',
  tools: [{ permission: 'auto', toolName: 'screen_read' }],
};
const payload = {
  apiName: 'screen_read',
  arguments: '{}',
  id: 'call-1',
  identifier: 'poki',
  type: 'mcp',
} as unknown as ChatToolPayload;
const relay = { relayDeviceId: 'home-linux', relayWorkspaceId: 'ws-1' };

describe.each([
  ['the desktop app', true],
  ['the web', false],
])('a view relayed from a device, on %s', (_name, isDesktop) => {
  beforeEach(() => {
    vi.clearAllMocks();
    environment.isDesktop = isDesktop;
    runConnector.mockResolvedValue(stdioConnector);
  });

  it("runs the view's calls through the server, on the device it came from", async () => {
    const { lambdaClient } = await import('@/libs/trpc/client');
    vi.mocked(lambdaClient.connector.callTool.mutate).mockResolvedValue({
      content: 'frame',
      success: true,
    } as never);

    await mcpService.invokeMcpToolCall(payload, { fromMcpApp: true, server: 'fp', ...relay });

    expect(lambdaClient.connector.callTool.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        fromApp: true,
        identifier: 'poki',
        server: 'fp',
        toolName: 'screen_read',
        ...relay,
      }),
      expect.anything(),
    );
    expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
  });

  it('reads the view through the server, from the device it came from', async () => {
    const { lambdaClient } = await import('@/libs/trpc/client');
    const resource = { contents: [{ text: '<p>screen</p>', uri: 'ui://poki/screen' }] };
    vi.mocked(lambdaClient.connector.readUiResource.query).mockResolvedValue(resource as never);

    await expect(
      mcpService.readMcpAppResource('poki', 'ui://poki/screen', { server: 'fp', ...relay }),
    ).resolves.toEqual(resource);
    expect(lambdaClient.connector.readUiResource.query).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'poki',
        server: 'fp',
        uri: 'ui://poki/screen',
        ...relay,
      }),
    );
    expect(mockElectronIpc.mcp.readUiResource).not.toHaveBeenCalled();
  });
});
