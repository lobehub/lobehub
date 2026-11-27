import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorToolPermission } from '@/database/schemas';
import { deviceGateway } from '@/server/services/deviceGateway';
import { resolveMcpDeviceFeatures } from '@/server/services/deviceGateway/deviceChannels';
import { resolveBoundMcpDevice } from '@/server/services/mcp/deviceTunnel';
import { getMcpParamsFingerprint } from '@/server/services/mcp/deviceView';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';
import { redisService } from '@/server/services/redis';

import { callConnectorToolById, readConnectorUiResourceById } from './exec';
import { scheduleStaleConnectorToolsRefresh } from './refresh';

vi.mock('@/server/services/mcp', () => ({ mcpService: { callTool: vi.fn() } }));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { executeMcpCall: vi.fn(), isConfigured: true, readMcpUiResource: vi.fn() },
}));
vi.mock('@/server/services/deviceGateway/deviceChannels', () => ({
  resolveMcpDeviceFeatures: vi.fn(),
}));
vi.mock('@/server/services/redis', () => ({
  redisService: {
    mcpDeviceRelay: { rememberTarget: vi.fn(async (_scope, fetch) => fetch()) },
  },
}));
vi.mock('@/server/services/mcp/deviceTunnel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveBoundMcpDevice: vi.fn(),
}));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppsEnabled: vi.fn() }));
vi.mock('./tokens', () => ({
  ensureFreshConnectorToken: vi.fn(async (c) => c),
  ensureFreshLinkToken: vi.fn(async (_c, link) => link),
}));
vi.mock('./refresh', () => ({
  buildLastSyncedAtMap: vi.fn(() => new Map()),
  connectorSyncContextForRow: vi.fn(() => ({})),
  scheduleStaleConnectorToolsRefresh: vi.fn(),
}));

/** A stdio MCP Apps server on the user's own machine, run through `lh connect`. */
const connector = (metadata: Record<string, unknown> | null = { boundDeviceId: 'nas' }) =>
  ({
    credentials: null,
    id: 'c1',
    identifier: 'poki',
    isEnabled: true,
    mcpConnectionType: 'stdio',
    mcpServerUrl: null,
    mcpStdioConfig: { args: ['stdio.mjs'], command: 'node', env: { TOKEN: 'secret' } },
    metadata,
    name: 'Poki',
    oidcConfig: null,
    workspaceId: null,
  }) as any;
const stdioParams = {
  args: ['stdio.mjs'],
  command: 'node',
  env: { TOKEN: 'secret' },
  name: 'poki',
  type: 'stdio' as const,
};
const tools = [
  {
    metadata: { mcpAppVisibility: ['app'] },
    permission: ConnectorToolPermission.auto,
    toolName: 'screen_read',
  },
  {
    metadata: { mcpAppVisibility: ['model'] },
    permission: ConnectorToolPermission.auto,
    toolName: 'look',
  },
  {
    metadata: { threadEntry: { title: 'Screen' } },
    permission: ConnectorToolPermission.auto,
    toolName: 'show_screen',
  },
];
const ctx = (row = connector()) =>
  ({
    agentModel: { existsById: vi.fn().mockResolvedValue(true) },
    connectorModel: {
      forRow() {
        return this;
      },
      getLinkModel: () => ({ listByConnectorIds: vi.fn().mockResolvedValue([]) }),
      queryByIdentifiers: vi.fn().mockResolvedValue([row]),
    },
    connectorToolModel: { queryByConnector: vi.fn().mockResolvedValue(tools) },
    serverDB: {},
    userId: 'u1',
  }) as any;
const call = async (over: Record<string, unknown> = {}, row = connector()) =>
  callConnectorToolById(
    {
      args: '{}',
      fromApp: true,
      identifier: 'poki',
      server: await getMcpParamsFingerprint(stdioParams),
      toolName: 'screen_read',
      ...over,
    },
    ctx(row),
  );
const sent = () => vi.mocked(deviceGateway.executeMcpCall).mock.calls[0][0];

describe("callConnectorToolById — an MCP App view's call relayed to a device", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMcpAppsEnabled).mockResolvedValue(true);
    vi.mocked(resolveMcpDeviceFeatures).mockResolvedValue(['apps']);
    vi.mocked(resolveBoundMcpDevice).mockImplementation(async ({ binding }) => ({
      clientKinds: ['cli'],
      deviceId: binding.deviceId,
      workspaceId: binding.workspaceId,
    }));
    vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
      content: 'frame',
      state: {
        content: [{ data: 'AAAA', mimeType: 'image/jpeg', type: 'image' }],
        mcpApp: { resourceUri: 'ui://poki/screen' },
      },
      success: true,
    } as never);
  });

  it("runs a view's call on the bound device, as a view's call, through a short-lived target cache", async () => {
    const result = (await call()) as any;

    expect(sent()).toMatchObject({
      apiName: 'screen_read',
      clientKinds: ['cli'],
      deviceId: 'nas',
      params: { ...stdioParams, mcpCall: { fromApp: true, mcpApps: true } },
      userId: 'u1',
    });
    expect(result.state.content[0]).toMatchObject({ data: 'AAAA', type: 'image' });
    expect(redisService.mcpDeviceRelay.rememberTarget).toHaveBeenCalledWith(
      { connectorId: 'c1', deviceId: 'nas', userId: 'u1', workspaceId: undefined },
      expect.any(Function),
    );
    // A poll many times a second schedules no tool-list refreshes
    expect(scheduleStaleConnectorToolsRefresh).not.toHaveBeenCalled();
  });

  it("runs an unbound connector's view call on the device its view names", async () => {
    await call({ relayDeviceId: 'laptop', relayWorkspaceId: 'ws1' }, connector(null));

    expect(resolveBoundMcpDevice).toHaveBeenCalledWith(
      expect.objectContaining({ binding: { deviceId: 'laptop', workspaceId: 'ws1' } }),
    );
    expect(sent()).toMatchObject({ deviceId: 'laptop', workspaceId: 'ws1' });
  });

  it('refuses an unbound connector view call that names no device, instead of guessing one', async () => {
    await expect(call({}, connector(null))).rejects.toHaveProperty('code', 'BAD_REQUEST');
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });

  it('refuses a view from another device than the connector is bound to now', async () => {
    await expect(call({ relayDeviceId: 'laptop' })).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });

  it('refuses a view from another server than the connector runs now', async () => {
    await expect(call({ server: 'another-server' })).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });

  it("refuses a view's call to a tool kept from views, whatever the device would do", async () => {
    await expect(call({ toolName: 'look' })).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });

  it("fails as a precondition on a device client that can't serve views", async () => {
    vi.mocked(resolveMcpDeviceFeatures).mockResolvedValue([]);

    await expect(call()).rejects.toHaveProperty('code', 'PRECONDITION_FAILED');
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });

  it("refuses a view's call while MCP Apps are off", async () => {
    vi.mocked(isMcpAppsEnabled).mockResolvedValue(false);

    await expect(call()).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });

  it('opens a thread entrypoint on the bound device, and its view is relayed back from there', async () => {
    const result = (await call({
      fromApp: undefined,
      fromEntrypoint: true,
      server: undefined,
      toolName: 'show_screen',
    })) as any;

    expect(sent().params.mcpCall).toEqual({ fromEntrypoint: true, mcpApps: true });
    expect(result.state.mcpApp).toEqual({
      relayDeviceId: 'nas',
      resourceUri: 'ui://poki/screen',
      server: await getMcpParamsFingerprint(stdioParams),
    });
  });

  it('refuses an entrypoint call to a tool that declares none', async () => {
    await expect(
      call({ fromApp: undefined, fromEntrypoint: true, server: undefined, toolName: 'look' }),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });

  it("keeps the view of a model call's result on a bound device that serves views", async () => {
    const result = (await call({ fromApp: undefined, server: undefined, toolName: 'look' })) as any;

    expect(sent().params.mcpCall).toEqual({ mcpApps: true });
    expect(result.state.mcpApp).toMatchObject({ relayDeviceId: 'nas' });
  });
});

describe("readConnectorUiResourceById — a device-run connector's view", () => {
  const read = async (over: Record<string, unknown> = {}, row = connector()) =>
    readConnectorUiResourceById(
      {
        identifier: 'poki',
        server: await getMcpParamsFingerprint(stdioParams),
        uri: 'ui://poki/screen',
        ...over,
      },
      ctx(row),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMcpAppsEnabled).mockResolvedValue(true);
    vi.mocked(resolveMcpDeviceFeatures).mockResolvedValue(['apps']);
    vi.mocked(resolveBoundMcpDevice).mockImplementation(async ({ binding }) => ({
      clientKinds: ['cli'],
      deviceId: binding.deviceId,
      workspaceId: binding.workspaceId,
    }));
    vi.mocked(deviceGateway.readMcpUiResource).mockResolvedValue({
      contents: [{ text: '<p>screen</p>', uri: 'ui://poki/screen' }],
    } as never);
  });

  it('reads the view on the device that runs the connector', async () => {
    await expect(read()).resolves.toEqual({
      contents: [{ text: '<p>screen</p>', uri: 'ui://poki/screen' }],
    });
    expect(deviceGateway.readMcpUiResource).toHaveBeenCalledWith({
      clientKinds: ['cli'],
      deviceId: 'nas',
      params: stdioParams,
      uri: 'ui://poki/screen',
      userId: 'u1',
      workspaceId: undefined,
    });
  });

  it("reads an unbound connector's view on the device it names", async () => {
    await read({ relayDeviceId: 'laptop' }, connector(null));
    expect(deviceGateway.readMcpUiResource).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'laptop' }),
    );
  });

  it('refuses a read from another server, or with no device to read on', async () => {
    await expect(read({ server: 'another-server' })).rejects.toHaveProperty('code', 'NOT_FOUND');
    await expect(read({}, connector(null))).rejects.toHaveProperty('code', 'BAD_REQUEST');
    expect(deviceGateway.readMcpUiResource).not.toHaveBeenCalled();
  });

  it("fails as a precondition on a device client that can't serve views", async () => {
    vi.mocked(resolveMcpDeviceFeatures).mockResolvedValue([]);
    await expect(read()).rejects.toHaveProperty('code', 'PRECONDITION_FAILED');
  });
});
