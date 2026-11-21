// @vitest-environment node
import { SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';

import { ToolExecutionService } from './index';

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  find: vi.fn(),
  links: vi.fn(),
  resolveTarget: vi.fn(),
  toolModelOptions: vi.fn(),
  tools: vi.fn(),
}));
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(function () {
    return {
      context: { db: {}, userId: 'me' },
      // Any row by id: the marker alone must never pick the connector
      findById: mocks.find,
      // The connector the call's identifier resolves to for the run
      resolveByIdentifiers: async (_identifiers: string[], target: unknown) => {
        mocks.resolveTarget(target);
        const row = await mocks.find();
        return row ? [row] : [];
      },
      resolveToolSets: async (target: unknown) => {
        mocks.resolveTarget(target);
        const row = await mocks.find();
        return row ? [{ ...row, toolIdentifier: row.toolIdentifier ?? row.identifier }] : [];
      },
      getLinkModel: () => ({ listByConnectorIds: mocks.links }),
    };
  }),
}));
vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn(function (_db, _userId, _workspaceId, options) {
    mocks.toolModelOptions(options);
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
  it("resolves the connector in the run's conversation, reading a personal row's tools", async () => {
    // Regression: discovery advertised a private agent's own private connector
    // (resolved with the topic), but dispatch re-resolved without it, found no
    // row or a shared sibling, and failed every call with a connector mismatch.
    const result = await service.executeTool(
      payload,
      context('https://mcp.example', { agentId: 'agt-private', topicId: 'tpc-own' }),
    );

    expect(result.success).toBe(true);
    // Every resolution (the permission gate's and the dispatch's) names the topic
    expect(mocks.resolveTarget.mock.calls.length).toBeGreaterThan(0);
    for (const [target] of mocks.resolveTarget.mock.calls)
      expect(target).toEqual({ agentId: 'agt-private', topicId: 'tpc-own' });
    expect(mocks.toolModelOptions).toHaveBeenCalledWith({ agentRun: true });
  });
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

// A single-account connector's manifest carries its endpoint and credentials
// from discovery: a row that has left the conversation's scope since must not
// keep running from that copy.
describe('connector row revalidation at dispatch', () => {
  const single = (url: string) =>
    ({
      userId: 'me',
      serverDB: {},
      toolManifestMap: {
        multi: {
          connector: { id: 'c', identifier: 'multi' },
          mcpParams: { auth: { accessToken: 'discovery-token' }, type: 'http', url },
        },
      },
    }) as any;

  it('refuses a call whose row the run no longer resolves', async () => {
    // Regression: made private mid-conversation, the shared row stopped
    // resolving, yet the discovery-time params kept running its account.
    mocks.find.mockResolvedValue(undefined);

    const result = await service.executeTool(
      { ...payload, arguments: '{"x":1}' },
      single('https://mcp.example'),
    );

    expect(result.success).toBe(false);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('refuses a call whose prefix now names another row', async () => {
    mocks.find.mockResolvedValue({ id: 'other', identifier: 'multi', isEnabled: true });

    const result = await service.executeTool(
      { ...payload, arguments: '{"x":1}' },
      single('https://mcp.example'),
    );

    expect(result.success).toBe(false);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('runs a call whose row still resolves', async () => {
    const result = await service.executeTool(
      { ...payload, arguments: '{"x":1}' },
      single('https://mcp.example'),
    );

    expect(result.success).toBe(true);
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
});
