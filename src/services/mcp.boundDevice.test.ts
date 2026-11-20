import { type ChatToolPayload } from '@lobechat/types';
import superjson from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpService } from './mcp';

// A server bound to a device runs on that device only: this desktop runs it
// over IPC when it IS that device, any other client (the web, another desktop)
// leaves it to the server, which tunnels it there.

const mockElectronIpc = {
  mcp: {
    callTool: vi.fn(),
    getStdioMcpServerManifest: vi.fn(),
    getStreamableMcpServerManifest: vi.fn(),
  },
};

const environment = vi.hoisted(() => ({ deviceId: 'this-desktop', isDesktop: true }));

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ gatewayDeviceInfo: { deviceId: environment.deviceId } }),
}));

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

vi.mock('@/utils/electron/ipc', () => ({ ensureElectronIpc: () => mockElectronIpc }));

vi.mock('./discover', () => ({
  discoverService: {
    reportPluginCall: vi.fn().mockResolvedValue(undefined),
    safeInjectMPToken: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockGetToolStoreState = vi.fn();
vi.mock('@/store/tool/store', () => ({ getToolStoreState: () => mockGetToolStoreState() }));
vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: {
    getCustomPluginById: () => () => undefined,
    getInstalledPluginById: () => () => undefined,
  },
}));

const LAN_URL = 'http://192.168.1.10:8000/mcp';
const payload = {
  apiName: 'list_files',
  arguments: '{}',
  id: 'call-1',
  identifier: 'nas',
  type: 'mcp',
} as unknown as ChatToolPayload;

// A LAN server: unbound, a desktop runs its calls here over IPC
const lanConnector = (boundDeviceId?: string) => ({
  id: 'nas-id',
  identifier: 'nas',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: LAN_URL,
  metadata: boundDeviceId ? { boundDeviceId } : null,
});

beforeEach(() => {
  vi.clearAllMocks();
  environment.isDesktop = true;
  environment.deviceId = 'this-desktop';
  mockElectronIpc.mcp.callTool.mockResolvedValue(
    superjson.serialize({ content: 'ok', success: true }),
  );
  mockElectronIpc.mcp.getStdioMcpServerManifest.mockResolvedValue(
    superjson.serialize({ api: [], identifier: 'nas' }),
  );
});

describe('a connector bound to a device', () => {
  it('leaves a call to the server when the bound device is another machine', async () => {
    const { lambdaClient } = await import('@/libs/trpc/client');
    mockGetToolStoreState.mockReturnValue({ connectors: [lanConnector('office-nas')] });
    vi.mocked(lambdaClient.connector.callTool.mutate).mockResolvedValue({
      content: 'ok',
      success: true,
    } as never);

    await mcpService.invokeMcpToolCall(payload, {});

    expect(lambdaClient.connector.callTool.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'nas', toolName: 'list_files' }),
      expect.anything(),
    );
    expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
  });

  it('runs a call here over IPC when this desktop is the bound device', async () => {
    const { lambdaClient } = await import('@/libs/trpc/client');
    mockGetToolStoreState.mockReturnValue({ connectors: [lanConnector('this-desktop')] });
    vi.mocked(lambdaClient.connector.getForRun.query).mockResolvedValue({
      ...lanConnector('this-desktop'),
      credentials: null,
      tools: [{ permission: 'auto', toolName: 'list_files' }],
    } as never);

    await mcpService.invokeMcpToolCall(payload, {});

    expect(mockElectronIpc.mcp.callTool).toHaveBeenCalledOnce();
    expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
  });
});

describe('a connector rebound since this client loaded it', () => {
  it('leaves the call to the server when the fresh binding names another device', async () => {
    const { lambdaClient } = await import('@/libs/trpc/client');
    // The stored projection is still unbound, so the call looks local
    mockGetToolStoreState.mockReturnValue({ connectors: [lanConnector()] });
    vi.mocked(lambdaClient.connector.getForRun.query).mockResolvedValue({
      ...lanConnector('office-nas'),
      credentials: null,
      tools: [{ permission: 'auto', toolName: 'list_files' }],
    } as never);
    vi.mocked(lambdaClient.connector.callTool.mutate).mockResolvedValue({
      content: 'ok',
      success: true,
    } as never);

    await mcpService.invokeMcpToolCall(payload, {});

    expect(lambdaClient.connector.callTool.mutate).toHaveBeenCalledOnce();
    expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
  });
});

describe('testing a server bound to a device', () => {
  it('starts a stdio server bound to another machine there, through the server', async () => {
    const { lambdaClient } = await import('@/libs/trpc/client');
    vi.mocked(lambdaClient.connector.getDeviceMcpManifest.mutate).mockResolvedValue({
      api: [],
      identifier: 'nas',
    } as never);

    await mcpService.getStdioMcpServerManifest({
      args: ['serve'],
      boundDeviceId: 'office-nas',
      command: 'my-mcp',
      name: 'nas',
    });

    expect(lambdaClient.connector.getDeviceMcpManifest.mutate).toHaveBeenCalledWith(
      {
        args: ['serve'],
        boundDeviceId: 'office-nas',
        command: 'my-mcp',
        env: undefined,
        identifier: 'nas',
        metadata: undefined,
        type: 'stdio',
      },
      expect.anything(),
    );
    expect(mockElectronIpc.mcp.getStdioMcpServerManifest).not.toHaveBeenCalled();
  });

  it('starts a stdio server bound to this desktop here, without the binding', async () => {
    const { lambdaClient } = await import('@/libs/trpc/client');

    await mcpService.getStdioMcpServerManifest({
      args: ['serve'],
      boundDeviceId: 'this-desktop',
      command: 'my-mcp',
      name: 'nas',
    });

    const sent = superjson.deserialize(
      mockElectronIpc.mcp.getStdioMcpServerManifest.mock.calls[0][0],
    ) as Record<string, unknown>;
    expect(sent).toMatchObject({ command: 'my-mcp', name: 'nas' });
    expect(sent).not.toHaveProperty('boundDeviceId');
    expect(lambdaClient.connector.getDeviceMcpManifest.mutate).not.toHaveBeenCalled();
  });

  it('reads a LAN server bound to a device through the server on the web', async () => {
    const { lambdaClient, toolsClient } = await import('@/libs/trpc/client');
    environment.isDesktop = false;
    vi.mocked(lambdaClient.connector.getDeviceMcpManifest.mutate).mockResolvedValue({
      api: [],
      identifier: 'nas',
      mcpParams: { connectVia: 'device', name: 'nas', type: 'http', url: LAN_URL },
    } as never);

    const manifest = await mcpService.getStreamableMcpServerManifest({
      auth: { type: 'none' },
      boundDeviceId: 'office-nas',
      identifier: 'nas',
      url: LAN_URL,
    });

    expect(lambdaClient.connector.getDeviceMcpManifest.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ boundDeviceId: 'office-nas', identifier: 'nas', url: LAN_URL }),
      expect.anything(),
    );
    // An `auto` server keeps the params its calls send
    expect(manifest.mcpParams).not.toHaveProperty('connectVia');
    expect(toolsClient.mcp.getStreamableMcpServerManifest.query).not.toHaveBeenCalled();
  });
});
