// @vitest-environment node
import { SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';

import { ToolExecutionService } from './index';

const mocks = vi.hoisted(() => ({ find: vi.fn(), links: vi.fn(), call: vi.fn(), tools: vi.fn() }));
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(function () {
    return {
      context: { db: {}, userId: 'me' },
      // Any row by id: the marker alone must never pick the connector
      findById: mocks.find,
      // The connector the call's identifier resolves to for the run
      resolveByIdentifiers: async () => {
        const row = await mocks.find();
        return row ? [row] : [];
      },
      getLinkModel: () => ({ listByConnectorIds: mocks.links }),
    };
  }),
}));
vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn(function () {
    return { queryByConnector: mocks.tools };
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppsEnabled: async () => false }));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { isConfigured: true, executeMcpCall: vi.fn() },
}));
vi.mock('@/server/services/deviceGateway/deviceChannels', () => ({
  resolveDeviceClientKind: async () => 'desktop',
  resolveMcpClientKinds: async () => ['desktop'],
}));
vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: async () => undefined,
}));
vi.mock('./serverRuntimes/resolveWorkspaceScope', () => ({
  resolveRunWorkspaceId: async () => undefined,
}));
const service = new ToolExecutionService({
  builtinToolsExecutor: {} as never,
  mcpService: { callTool: mocks.call } as never,
});
const payload = {
  apiName: 'echo',
  arguments: '{"link_id":"lnk_b","x":1}',
  identifier: 'multi',
  id: 'call',
  type: 'mcp' as const,
};
const context = (url: string, extra = {}) =>
  ({
    userId: 'me',
    serverDB: {},
    toolManifestMap: {
      multi: {
        mcpParams: { type: 'http', url },
        connectorLinks: { connectorId: 'c', param: 'link_id' },
      },
    },
    ...extra,
  }) as any;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue({
    id: 'c',
    identifier: 'multi',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example',
    credentials: null,
    // Accounts belong to OAuth connectors, which always carry their client.
    oidcConfig: { clientId: 'client', scheme: 'dcr' },
  });
  mocks.links.mockResolvedValue(
    ['a', 'b'].map((id) => ({
      id: `lnk_${id}`,
      userConnectorId: 'c',
      name: id,
      status: 'connected',
      credentials: { type: 'oauth2', accessToken: `token-${id}` },
    })),
  );
  mocks.call.mockResolvedValue({ content: 'ok', success: true });
  mocks.tools.mockResolvedValue([{ permission: 'auto', toolName: 'echo', userConnectorId: 'c' }]);
  vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
    success: true,
    content: 'device ok',
  });
});
describe('live connector account resolution at dispatch', () => {
  it('resolves the selected token and strips the selector before HTTP execution', async () => {
    const result = await service.executeTool(payload, context('https://mcp.example'));
    expect(result.success).toBe(true);
    expect(mocks.call.mock.calls[0][0]).toMatchObject({
      argsStr: '{"x":1}',
      clientParams: { auth: { accessToken: 'token-b' } },
    });
  });
  it('resolves the selected token and strips the selector before device execution', async () => {
    mocks.find.mockResolvedValue({
      id: 'c',
      identifier: 'multi',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'http://localhost:1234/mcp',
      credentials: null,
      oidcConfig: { clientId: 'client', scheme: 'dcr' },
    });
    const result = await service.executeTool(
      payload,
      context('http://localhost:1234/mcp', {
        activeDeviceId: 'device',
      }),
    );
    expect(result.success).toBe(true);
    expect(vi.mocked(deviceGateway.executeMcpCall).mock.calls[0][0]).toMatchObject({
      arguments: '{"x":1}',
      params: { auth: { accessToken: 'token-b' } },
    });
  });
  it('does not silently pick another account and uses neutral names for visitor errors', async () => {
    const result = await service.executeTool(
      { ...payload, arguments: '{}' },
      context('https://mcp.example', { agentShareVisitor: {} }),
    );
    expect(result).toMatchObject({ success: false, content: expect.stringContaining('Account 1') });
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it('includes selected account on authorization failure and disallows switching without consent', async () => {
    mocks.call.mockRejectedValueOnce(
      new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'expired', { status: 401 }),
    );
    const result = await service.executeTool(payload, context('https://mcp.example'));
    expect(result).toMatchObject({
      success: false,
      content: expect.stringContaining("Account 'b'"),
    });
    expect(result.content).toContain("without the user's consent");
  });
  it('rechecks the live endpoint before a shared visitor resolves any account credentials', async () => {
    mocks.find.mockResolvedValue({
      id: 'c',
      identifier: 'multi',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'http://localhost:1234/mcp',
      credentials: null,
      oidcConfig: { clientId: 'client', scheme: 'dcr' },
    });
    const result = await service.executeTool(
      payload,
      context('https://old-public.example', { agentShareVisitor: {} }),
    );
    expect(result).toMatchObject({ success: false, error: { code: 'SHARE_GATE_BLOCKED' } });
    expect(mocks.links).not.toHaveBeenCalled();
    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it('lets a shared visitor reach a device-only MCP under the share device grant', async () => {
    mocks.find.mockResolvedValue({
      id: 'c',
      identifier: 'multi',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'http://localhost:1234/mcp',
      credentials: null,
      oidcConfig: { clientId: 'client', scheme: 'dcr' },
    });
    const result = await service.executeTool(
      payload,
      context('http://localhost:1234/mcp', {
        activeDeviceId: 'device',
        agentShareVisitor: { canUseDevice: true },
      }),
    );
    expect(result).not.toMatchObject({ error: { code: 'SHARE_GATE_BLOCKED' } });
    expect(deviceGateway.executeMcpCall).toHaveBeenCalled();
  });
  it('retains the selected account on serialized device failures', async () => {
    mocks.find.mockResolvedValue({
      id: 'c',
      identifier: 'multi',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'http://localhost:1234/mcp',
      credentials: null,
      oidcConfig: { clientId: 'client', scheme: 'dcr' },
    });
    vi.mocked(deviceGateway.executeMcpCall).mockResolvedValueOnce({
      success: false,
      content: 'Provider rejected authorization',
      error: '401',
    });
    const result = await service.executeTool(
      payload,
      context('http://localhost:1234/mcp', { activeDeviceId: 'device' }),
    );
    expect(result).toMatchObject({
      success: false,
      content: expect.stringContaining("account 'b'"),
    });
    expect(result.content).toContain("without the user's consent");
    expect(result.content).toContain('Provider rejected authorization');
  });

  // A plugin row can carry any manifest, marker included
  describe('a marker the connector does not back', () => {
    it('lends no account to a manifest whose marker names another connector', async () => {
      const result = await service.executeTool(payload, {
        ...context('https://mcp.example'),
        toolManifestMap: {
          multi: {
            mcpParams: { type: 'http', url: 'https://mcp.example' },
            connectorLinks: { connectorId: 'someone-elses', param: 'link_id' },
          },
        },
      });
      expect(result).toMatchObject({ success: false });
      expect(mocks.links).not.toHaveBeenCalled();
      expect(mocks.call).not.toHaveBeenCalled();
    });
    it('blocks a tool the connector has disabled', async () => {
      mocks.tools.mockResolvedValue([
        { permission: 'disabled', toolName: 'echo', userConnectorId: 'c' },
      ]);
      const result = await service.executeTool(payload, context('https://mcp.example'));
      expect(result.content).toContain('has been disabled by the user');
      expect(mocks.links).not.toHaveBeenCalled();
      expect(mocks.call).not.toHaveBeenCalled();
    });
    it('refuses a tool the connector does not serve', async () => {
      const result = await service.executeTool(
        { ...payload, apiName: 'not_synced' },
        context('https://mcp.example'),
      );
      expect(result).toMatchObject({ success: false });
      expect(mocks.links).not.toHaveBeenCalled();
      expect(mocks.call).not.toHaveBeenCalled();
    });
  });
});
