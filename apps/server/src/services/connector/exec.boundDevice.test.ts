import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorToolPermission } from '@/database/schemas';
import { deviceGateway } from '@/server/services/deviceGateway';
import { mcpService } from '@/server/services/mcp';
import {
  McpBoundDeviceUnavailableError,
  resolveBoundMcpDevice,
} from '@/server/services/mcp/deviceTunnel';

import { callConnectorToolById } from './exec';

vi.mock('@/server/services/mcp', () => ({ mcpService: { callTool: vi.fn() } }));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { executeMcpCall: vi.fn(), isConfigured: true },
}));
vi.mock('@/server/services/mcp/deviceTunnel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveBoundMcpDevice: vi.fn(),
}));
vi.mock('@/server/services/mcp/featureGate', () => ({
  isMcpAppsEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock('./tokens', () => ({
  ensureFreshConnectorToken: vi.fn(async (c) => c),
  ensureFreshLinkToken: vi.fn(async (_c, link) => link),
}));
vi.mock('./refresh', () => ({
  buildLastSyncedAtMap: vi.fn(() => new Map()),
  scheduleStaleConnectorToolsRefresh: vi.fn(),
}));

const serverDB = {} as never;
const stdioConnector = (metadata: Record<string, unknown> | null, workspaceId?: string) =>
  ({
    credentials: null,
    id: 'c1',
    identifier: 'local-tool',
    isEnabled: true,
    mcpConnectionType: 'stdio',
    mcpServerUrl: null,
    mcpStdioConfig: { args: ['serve'], command: 'my-mcp', env: { TOKEN: 'secret' } },
    metadata,
    name: 'Local tool',
    oidcConfig: null,
    workspaceId: workspaceId ?? null,
  }) as any;

const makeCtx = (connector: any, links: any[] = []) =>
  ({
    agentModel: { existsById: vi.fn().mockResolvedValue(true) },
    connectorModel: {
      // A personal row of a personal-scope call is in the run's own scope
      forRow() {
        return this;
      },
      getLinkModel: () => ({ listByConnectorIds: vi.fn().mockResolvedValue(links) }),
      queryByIdentifiers: vi.fn().mockResolvedValue([connector]),
    },
    connectorToolModel: {
      queryByConnector: vi
        .fn()
        .mockResolvedValue([{ permission: ConnectorToolPermission.auto, toolName: 'do_thing' }]),
    },
    serverDB,
    userId: 'u1',
  }) as any;

const call = (connector: any, over: Record<string, unknown> = {}) =>
  callConnectorToolById(
    { args: '{"q":1}', identifier: 'local-tool', toolName: 'do_thing', ...over },
    makeCtx(connector),
  );

const oauthAccount = (id: string, accessToken: string) => ({
  credentials: { accessToken, type: 'oauth2' },
  id,
  name: id,
  status: 'connected',
  userConnectorId: 'c1',
  userId: 'u1',
});
const lanOAuthConnector = {
  ...stdioConnector({ boundDeviceId: 'ws-nas' }, 'ws1'),
  mcpConnectionType: 'http',
  mcpServerUrl: 'http://192.168.1.5/mcp',
  mcpStdioConfig: null,
  oidcConfig: { clientId: 'client', scheme: 'dcr' },
};

describe('callConnectorToolById — connector bound to a device', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveBoundMcpDevice).mockResolvedValue({
      clientKinds: ['desktop'],
      deviceId: 'ws-nas',
      workspaceId: 'ws1',
    });
    vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
      content: 'done',
      state: { content: [{ text: 'done', type: 'text' }], mcpApp: { resourceUri: 'ui://x' } },
      success: true,
    } as never);
  });

  it('runs the tool on the bound device, without the view a device result offers', async () => {
    await expect(call(stdioConnector({ boundDeviceId: 'ws-nas' }, 'ws1'))).resolves.toEqual({
      content: 'done',
      state: { content: [{ text: 'done', type: 'text' }] },
      success: true,
    });

    expect(resolveBoundMcpDevice).toHaveBeenCalledWith({
      binding: { deviceId: 'ws-nas', workspaceId: 'ws1' },
      identifier: 'local-tool',
      serverDB,
      userId: 'u1',
    });
    expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith({
      apiName: 'do_thing',
      arguments: '{"q":1}',
      clientKinds: ['desktop'],
      deviceId: 'ws-nas',
      identifier: 'local-tool',
      params: {
        args: ['serve'],
        command: 'my-mcp',
        env: { TOKEN: 'secret' },
        name: 'local-tool',
        type: 'stdio',
      },
      userId: 'u1',
      workspaceId: 'ws1',
    });
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it("sends the selected account's token and the arguments without the selector", async () => {
    const links = [oauthAccount('lnk_a', 'alice-token'), oauthAccount('lnk_b', 'bob-token')];
    await callConnectorToolById(
      { args: '{"link_id":"lnk_b","q":1}', identifier: 'local-tool', toolName: 'do_thing' },
      makeCtx(lanOAuthConnector, links),
    );

    expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: '{"q":1}',
        params: expect.objectContaining({
          auth: { accessToken: 'bob-token', type: 'oauth2' },
          type: 'http',
        }),
      }),
    );
  });

  it('fails a call that names no account of a connector holding several', async () => {
    const links = [oauthAccount('lnk_a', 'alice-token'), oauthAccount('lnk_b', 'bob-token')];
    await expect(
      callConnectorToolById(
        { args: '{"q":1}', identifier: 'local-tool', toolName: 'do_thing' },
        makeCtx(lanOAuthConnector, links),
      ),
    ).resolves.toMatchObject({
      error: { type: 'CONNECTOR_ACCOUNT_SELECTION' },
      success: false,
    });
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });

  it("keeps a failure's error marker and details from the device", async () => {
    vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
      content: 'Device call timed out',
      error: 'TIMEOUT',
      success: false,
    } as never);

    await expect(call(stdioConnector({ boundDeviceId: 'ws-nas' }))).resolves.toEqual({
      content: 'Device call timed out',
      error: { code: 'MCP_DEVICE_EXECUTION_ERROR', message: 'TIMEOUT' },
      state: undefined,
      success: false,
    });

    const errorData = { code: 'DEVICE_NOT_FOUND', deviceId: 'ws-nas', retryable: true };
    vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
      content: 'gone',
      errorData,
      success: false,
    } as never);

    await expect(call(stdioConnector({ boundDeviceId: 'ws-nas' }))).resolves.toMatchObject({
      error: errorData,
      success: false,
    });
  });

  it('fails as a precondition with the reason when the bound device is offline', async () => {
    vi.mocked(resolveBoundMcpDevice).mockRejectedValue(
      new McpBoundDeviceUnavailableError('local-tool', 'offline', 'Office NAS'),
    );

    await expect(call(stdioConnector({ boundDeviceId: 'ws-nas' }))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('"Office NAS", which is offline'),
    });
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });

  it('still refuses an unbound device-only connector, which the server cannot reach', async () => {
    await expect(call(stdioConnector(null))).rejects.toHaveProperty('code', 'BAD_REQUEST');
    expect(resolveBoundMcpDevice).not.toHaveBeenCalled();
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });

  it("refuses a view's call: a device result offers no view to call back into", async () => {
    await expect(
      call(stdioConnector({ boundDeviceId: 'ws-nas' }), { fromEntrypoint: true }),
    ).rejects.toHaveProperty('code', 'BAD_REQUEST');
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
  });
});
