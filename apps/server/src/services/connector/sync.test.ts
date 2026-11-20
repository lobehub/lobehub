import { describe, expect, it, vi } from 'vitest';

import type { DecryptedConnector } from '@/database/models/connector';
import type { ConnectorCredentials } from '@/database/schemas';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';
import { mcpService } from '@/server/services/mcp';
import { listMcpToolsOnDevice } from '@/server/services/mcp/deviceTunnel';

import {
  buildConnectorMcpParams,
  buildHttpAuthFromCredentials,
  syncConnectorToolsById,
} from './sync';

vi.mock('@/server/services/mcp', () => ({
  mcpService: { listRawTools: vi.fn(), getEventsCapability: vi.fn() },
}));
const gateway = vi.hoisted(() => ({ isConfigured: false }));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: gateway }));
vi.mock('@/server/services/mcp/deviceTunnel', () => ({ listMcpToolsOnDevice: vi.fn() }));
const mcpAppsEnabled = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const webhookEnabled = vi.hoisted(() => vi.fn().mockResolvedValue(false));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppsEnabled: mcpAppsEnabled }));
vi.mock('@/server/services/inboundWebhook/featureGate', () => ({
  isWebhookEnabled: webhookEnabled,
}));
vi.mock('./tokens', () => ({
  ensureFreshConnectorToken: async (connector: unknown) => connector,
  ensureFreshLinkToken: async (_connector: unknown, link: unknown) => link,
}));

const httpConnector = (
  credentials: ConnectorCredentials | null,
  metadata?: Record<string, unknown>,
): DecryptedConnector =>
  ({
    credentials,
    id: 'c1',
    identifier: 'my-conn',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example.com',
    mcpStdioConfig: null,
    metadata: metadata ?? null,
    name: 'My Connector',
    oidcConfig: null,
  }) as any;

describe('buildHttpAuthFromCredentials', () => {
  it('returns nothing for no credentials (no-auth)', () => {
    expect(buildHttpAuthFromCredentials(null)).toEqual({});
  });

  it('maps oauth2 to the access token alone, already refreshed by the caller', () => {
    const result = buildHttpAuthFromCredentials({
      accessToken: 'access',
      clientSecret: 'secret',
      expiresAt: 123,
      refreshToken: 'refresh',
      type: 'oauth2',
    });

    expect(result).toEqual({ auth: { accessToken: 'access', type: 'oauth2' } });
    expect(result.headers).toBeUndefined();
  });

  it('maps a bearer token to bearer auth', () => {
    expect(buildHttpAuthFromCredentials({ token: 'tok', type: 'bearer' })).toEqual({
      auth: { token: 'tok', type: 'bearer' },
    });
  });

  it('maps an api key to bearer auth (Authorization header)', () => {
    expect(buildHttpAuthFromCredentials({ apiKey: 'key-123', type: 'apikey' })).toEqual({
      auth: { token: 'key-123', type: 'bearer' },
    });
  });

  it('passes custom headers through verbatim with no auth', () => {
    const result = buildHttpAuthFromCredentials({
      headers: { 'X-Api-Key': 'abc', 'X-Tenant': 't1' },
      type: 'header',
    });

    expect(result).toEqual({ headers: { 'X-Api-Key': 'abc', 'X-Tenant': 't1' } });
    expect(result.auth).toBeUndefined();
  });
});

describe('buildConnectorMcpParams', () => {
  it('matches the params agent runs use for an OAuth connector too', () => {
    const connector = httpConnector({
      accessToken: 'access',
      clientSecret: 'secret',
      expiresAt: 123,
      refreshToken: 'refresh',
      type: 'oauth2',
    });
    const [manifest] = buildConnectorManifests(
      [connector],
      [{ toolName: 'do_thing', userConnectorId: 'c1' } as any],
    );

    expect(buildConnectorMcpParams(connector)).toEqual((manifest as any).mcpParams);
  });

  it('matches the params agent runs use, so a view reaches the same MCP session', () => {
    // Display name differs from the identifier: the session key must not depend on it
    const connector = httpConnector(
      { token: 'tok', type: 'bearer' },
      { customHeaders: { x: '1' } },
    );
    const [manifest] = buildConnectorManifests(
      [connector],
      [{ toolName: 'do_thing', userConnectorId: 'c1' } as any],
    );

    expect(buildConnectorMcpParams(connector)).toEqual((manifest as any).mcpParams);
  });

  it('builds http params with bearer auth', () => {
    expect(buildConnectorMcpParams(httpConnector({ token: 'tok', type: 'bearer' }))).toEqual({
      auth: { token: 'tok', type: 'bearer' },
      headers: undefined,
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('builds http params with custom headers and no auth', () => {
    expect(
      buildConnectorMcpParams(
        httpConnector({ headers: { Authorization: 'Token x' }, type: 'header' }),
      ),
    ).toEqual({
      auth: undefined,
      headers: { Authorization: 'Token x' },
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('merges metadata.customHeaders alongside bearer auth', () => {
    expect(
      buildConnectorMcpParams(
        httpConnector({ token: 'tok', type: 'bearer' }, { customHeaders: { 'X-Tenant': 't1' } }),
      ),
    ).toEqual({
      auth: { token: 'tok', type: 'bearer' },
      headers: { 'X-Tenant': 't1' },
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('applies metadata.customHeaders with no auth credential', () => {
    expect(
      buildConnectorMcpParams(httpConnector(null, { customHeaders: { 'X-Api-Key': 'abc' } })),
    ).toEqual({
      auth: undefined,
      headers: { 'X-Api-Key': 'abc' },
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('lets metadata.customHeaders override legacy header-credential keys', () => {
    expect(
      buildConnectorMcpParams(
        httpConnector(
          { headers: { Authorization: 'Token old' }, type: 'header' },
          { customHeaders: { Authorization: 'Token new' } },
        ),
      ),
    ).toEqual({
      auth: undefined,
      headers: { Authorization: 'Token new' },
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('builds http params with no auth when credentials are absent', () => {
    expect(buildConnectorMcpParams(httpConnector(null))).toEqual({
      auth: undefined,
      headers: undefined,
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('builds stdio params from stdio config', () => {
    const connector = {
      credentials: null,
      identifier: 'local-conn',
      mcpConnectionType: 'stdio',
      mcpServerUrl: null,
      mcpStdioConfig: { args: ['serve'], command: 'my-mcp', env: { FOO: 'bar' } },
      name: 'Local Connector',
    } as any;

    expect(buildConnectorMcpParams(connector)).toEqual({
      args: ['serve'],
      command: 'my-mcp',
      env: { FOO: 'bar' },
      name: 'local-conn',
      type: 'stdio',
    });
  });
});

describe('a connector bound to a device', () => {
  const stdioConnector = (metadata: Record<string, unknown> | null, workspaceId?: string) =>
    ({
      credentials: null,
      id: 'c1',
      identifier: 'local-conn',
      isEnabled: true,
      mcpConnectionType: 'stdio',
      mcpServerUrl: null,
      mcpStdioConfig: { args: ['serve'], command: 'my-mcp' },
      metadata,
      name: 'Local Connector',
      oidcConfig: null,
      userId: 'creator',
      workspaceId: workspaceId ?? null,
    }) as any;

  it('carries the binding, in its workspace, into the params agent runs use', () => {
    const connector = stdioConnector({ boundDeviceId: 'ws-nas' }, 'ws1');
    const [manifest] = buildConnectorManifests(
      [connector],
      [{ toolName: 'do_thing', userConnectorId: 'c1' } as any],
    );

    expect(buildConnectorMcpParams(connector)).toMatchObject({
      boundDevice: { deviceId: 'ws-nas', workspaceId: 'ws1' },
    });
    expect(buildConnectorMcpParams(connector)).toEqual((manifest as any).mcpParams);
  });

  it('ignores a binding left on a server the server reaches itself', () => {
    expect(
      buildConnectorMcpParams(httpConnector(null, { boundDeviceId: 'nas' })),
    ).not.toHaveProperty('boundDevice');
  });

  it("lets any member refresh a workspace connector's tools on its bound device", async () => {
    gateway.isConfigured = true;
    vi.mocked(listMcpToolsOnDevice).mockResolvedValue([
      { description: 'Do', inputSchema: { type: 'object' }, name: 'do_thing' },
    ]);
    try {
      const result = await syncConnectorToolsById('c1', {
        connectorModel: {
          findById: async () => stdioConnector({ boundDeviceId: 'ws-nas' }, 'ws1'),
          updateStatus: vi.fn(),
        } as any,
        connectorToolModel: { queryByConnector: async () => [], upsertMany: vi.fn() } as any,
        serverDB: {} as any,
        userId: 'another-member',
      });

      expect(result).toEqual({ toolCount: 1 });
      expect(listMcpToolsOnDevice).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            boundDevice: { deviceId: 'ws-nas', workspaceId: 'ws1' },
          }),
          userId: 'another-member',
        }),
      );
    } finally {
      gateway.isConfigured = false;
    }
  });

  it("still keeps an unbound workspace connector's device refresh to its creator", async () => {
    gateway.isConfigured = true;
    try {
      await expect(
        syncConnectorToolsById('c1', {
          connectorModel: {
            findById: async () => stdioConnector(null, 'ws1'),
            updateStatus: vi.fn(),
          } as any,
          connectorToolModel: { upsertMany: vi.fn() } as any,
          serverDB: {} as any,
          userId: 'another-member',
        }),
      ).rejects.toThrow(/only the member who set it up/);
    } finally {
      gateway.isConfigured = false;
    }
  });
});

describe('syncConnectorToolsById', () => {
  it("syncs view-only tools too, recording each tool's MCP Apps visibility", async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([
      { description: 'Show', inputSchema: { type: 'object' }, name: 'show_dashboard' },
      {
        _meta: { ui: { visibility: ['app'] } },
        description: 'Page',
        inputSchema: { type: 'object' },
        name: 'load_page',
      },
    ]);
    const upsertMany = vi.fn();
    const updateStatus = vi.fn();

    const result = await syncConnectorToolsById('c1', {
      connectorModel: {
        getLinkModel: () => ({ listByConnectorIds: async () => [] }),
        findById: async () => httpConnector(null),
        updateStatus,
      } as any,
      connectorToolModel: { queryByConnector: async () => [], upsertMany } as any,
    });

    expect(result).toEqual({ toolCount: 2 });
    expect(upsertMany).toHaveBeenCalledWith('c1', [
      expect.objectContaining({ metadata: null, toolName: 'show_dashboard' }),
      expect.objectContaining({ metadata: { visibility: ['app'] }, toolName: 'load_page' }),
    ]);
  });

  it('applies the approval a marketplace manifest gives a listed tool', async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([
      { inputSchema: { type: 'object' }, name: 'search' },
      { inputSchema: { type: 'object' }, name: 'send' },
      { inputSchema: { type: 'object' }, name: 'delete' },
    ]);
    const upsertMany = vi.fn();

    await syncConnectorToolsById(
      'c1',
      {
        connectorModel: { findById: async () => httpConnector(null), updateStatus: vi.fn() } as any,
        connectorToolModel: { upsertMany } as any,
      },
      {
        humanInterventions: new Map([
          ['send', 'required'],
          ['delete', 'always'],
        ]),
      },
    );

    expect(upsertMany).toHaveBeenCalledWith('c1', [
      expect.objectContaining({ defaultPermission: 'auto', metadata: null, toolName: 'search' }),
      expect.objectContaining({
        defaultPermission: 'needs_approval',
        metadata: null,
        toolName: 'send',
      }),
      // An `always` stays mandatory past auto-run
      expect.objectContaining({
        defaultPermission: 'needs_approval',
        metadata: { mandatoryApproval: true },
        toolName: 'delete',
      }),
    ]);
  });

  it('keeps the mandatory mark a tool has when no marketplace policy is supplied', async () => {
    // A refresh (background, manual, OAuth callback) only has the server's
    // listing, which cannot say whether the manifest's `always` still applies
    vi.mocked(mcpService.listRawTools).mockResolvedValue([
      { inputSchema: { type: 'object' }, name: 'search' },
      { _meta: { ui: { visibility: ['model'] } }, inputSchema: { type: 'object' }, name: 'delete' },
    ]);
    const upsertMany = vi.fn();

    await syncConnectorToolsById('c1', {
      connectorModel: { findById: async () => httpConnector(null), updateStatus: vi.fn() } as any,
      connectorToolModel: {
        queryByConnector: async () => [
          { metadata: null, permission: 'auto', toolName: 'search' },
          { metadata: { mandatoryApproval: true }, permission: 'auto', toolName: 'delete' },
        ],
        upsertMany,
      } as any,
    });

    expect(upsertMany).toHaveBeenCalledWith('c1', [
      expect.objectContaining({ metadata: null, toolName: 'search' }),
      expect.objectContaining({
        metadata: { mandatoryApproval: true, visibility: ['model'] },
        toolName: 'delete',
      }),
    ]);
  });

  it.each([
    [
      'an install applies the manifest policy',
      { humanInterventions: new Map([['board', 'always']]) },
    ],
    ['a refresh keeps the stored mark', {}],
  ])(
    "keeps a mandatory tool's MCP App metadata under the mcp_apps flag: %s",
    async (_case, options) => {
      mcpAppsEnabled.mockResolvedValueOnce(true);
      vi.mocked(mcpService.listRawTools).mockResolvedValue([
        {
          _meta: {
            'lobehub/ui': { entrypoints: [{ type: 'thread' }] },
            'ui': { resourceUri: 'ui://board', visibility: ['model', 'app'] },
          },
          inputSchema: { type: 'object' },
          name: 'board',
        },
      ]);
      const upsertMany = vi.fn();

      await syncConnectorToolsById(
        'c1',
        {
          connectorModel: {
            findById: async () => httpConnector(null),
            updateStatus: vi.fn(),
          } as any,
          connectorToolModel: {
            queryByConnector: async () => [
              { metadata: { mandatoryApproval: true }, permission: 'auto', toolName: 'board' },
            ],
            upsertMany,
          } as any,
          userId: 'user-1',
        },
        options,
      );

      expect(upsertMany).toHaveBeenCalledWith('c1', [
        expect.objectContaining({
          metadata: expect.objectContaining({
            entrypoints: [{ type: 'thread' }],
            mandatoryApproval: true,
            threadEntry: expect.objectContaining({ toolName: 'board' }),
            visibility: ['model', 'app'],
          }),
          toolName: 'board',
        }),
      ]);
    },
  );

  it.each([
    [
      'an install, with the manifest policy',
      { humanInterventions: new Map<string, unknown>([['send', 'required']]) },
    ],
    ['a refresh, with the listing alone', {}],
  ])(
    'applies the market policies the connector stores, always for an undeclared tool: %s',
    async (_case, options) => {
      // The server lists a tool the market never did, and one it renamed
      vi.mocked(mcpService.listRawTools).mockResolvedValue([
        { inputSchema: { type: 'object' }, name: 'search' },
        { inputSchema: { type: 'object' }, name: 'send' },
        { inputSchema: { type: 'object' }, name: 'exfiltrate' },
        { inputSchema: { type: 'object' }, name: 'search_v2' },
      ]);
      const upsertMany = vi.fn();

      await syncConnectorToolsById(
        'c1',
        {
          connectorModel: {
            findById: async () =>
              httpConnector(null, {
                marketplaceToolPolicies: { search: null, send: 'required' },
              }),
            updateStatus: vi.fn(),
          } as any,
          connectorToolModel: { queryByConnector: async () => [], upsertMany } as any,
        },
        options,
      );

      const [, inputs] = upsertMany.mock.calls[0];
      expect(
        Object.fromEntries(
          inputs.map((tool: any) => [tool.toolName, [tool.defaultPermission, tool.metadata]]),
        ),
      ).toEqual({
        exfiltrate: ['needs_approval', { mandatoryApproval: true }],
        search: ['auto', null],
        search_v2: ['needs_approval', { mandatoryApproval: true }],
        // The stored policy holds without the install's manifest too
        send: ['needs_approval', null],
      });
    },
  );

  it('drops only the auto tools the server no longer lists when asked to', async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([
      { description: 'Kept', inputSchema: { type: 'object' }, name: 'kept' },
    ]);
    const deleteToolsNotIn = vi.fn();
    const connectorToolModel = {
      deleteToolsNotIn,
      queryByConnector: async () => [
        { permission: 'auto', toolName: 'kept' },
        { permission: 'auto', toolName: 'gone' },
        { permission: 'needs_approval', toolName: 'gated' },
      ],
      upsertMany: vi.fn(),
    };
    const connectorModel = { findById: async () => httpConnector(null), updateStatus: vi.fn() };

    await syncConnectorToolsById('c1', { connectorModel, connectorToolModel } as any);
    expect(deleteToolsNotIn).not.toHaveBeenCalled();

    await syncConnectorToolsById('c1', { connectorModel, connectorToolModel } as any, {
      pruneMissingAutoTools: true,
    });
    expect(deleteToolsNotIn).toHaveBeenCalledWith('c1', ['kept', 'gated']);
  });

  it.each([true, false])(
    "lists on a session announcing MCP Apps under the user's flag (%s)",
    async (enabled) => {
      // A server may list the tools only its views call just to such a client
      mcpAppsEnabled.mockResolvedValueOnce(enabled);
      vi.mocked(mcpService.listRawTools).mockResolvedValue([]);

      await syncConnectorToolsById('c1', {
        connectorModel: {
          getLinkModel: () => ({ listByConnectorIds: async () => [] }),
          findById: async () => httpConnector(null),
          updateStatus: vi.fn(),
        } as any,
        connectorToolModel: { queryByConnector: async () => [], upsertMany: vi.fn() } as any,
        userId: 'user-1',
      });

      expect(mcpAppsEnabled).toHaveBeenCalledWith('user-1');
      expect(mcpService.listRawTools).toHaveBeenCalledWith(expect.anything(), {
        mcpApps: enabled,
        mcpEvents: false,
      });
    },
  );

  describe('an OAuth connector with accounts', () => {
    const oauthConnector = () =>
      ({ ...httpConnector(null), oidcConfig: { clientId: 'client-1' } }) as DecryptedConnector;
    const account = (id: string, accessToken: string) => ({
      credentials: { accessToken, type: 'oauth2' },
      id,
      name: id,
      status: 'connected',
      tokenExpiresAt: null,
      userConnectorId: 'c1',
    });
    const setup = (links: ReturnType<typeof account>[]) => {
      const connectorModel = { findById: async () => oauthConnector(), updateStatus: vi.fn() };
      const connectorLinkModel = { listByConnectorIds: async () => links, updateStatus: vi.fn() };
      const connectorToolModel = { queryByConnector: async () => [], upsertMany: vi.fn() };
      const ctx = { connectorLinkModel, connectorModel, connectorToolModel } as any;
      return { connectorLinkModel, connectorModel, connectorToolModel, ctx };
    };

    it('lists as the account asked for and marks it, and the connector, connected', async () => {
      vi.mocked(mcpService.listRawTools).mockResolvedValue([
        { inputSchema: { type: 'object' }, name: 'search' },
      ]);
      const { connectorLinkModel, connectorModel, connectorToolModel, ctx } = setup([
        account('lnk_a', 'token-a'),
        account('lnk_b', 'token-b'),
      ]);

      await expect(syncConnectorToolsById('c1', ctx, { linkId: 'lnk_b' })).resolves.toEqual({
        toolCount: 1,
      });

      expect(mcpService.listRawTools).toHaveBeenLastCalledWith(
        expect.objectContaining({ auth: { accessToken: 'token-b', type: 'oauth2' } }),
        expect.anything(),
      );
      expect(connectorToolModel.upsertMany).toHaveBeenCalledWith('c1', [
        expect.objectContaining({ toolName: 'search' }),
      ]);
      expect(connectorLinkModel.updateStatus).toHaveBeenCalledWith('c1', 'lnk_b', 'connected');
      expect(connectorModel.updateStatus).toHaveBeenCalledWith('c1', 'connected');
    });

    it('marks only the failing account when the connector has others', async () => {
      vi.mocked(mcpService.listRawTools).mockRejectedValue(new Error('unauthorized'));
      const { connectorLinkModel, connectorModel, connectorToolModel, ctx } = setup([
        account('lnk_a', 'token-a'),
        account('lnk_b', 'token-b'),
      ]);

      await expect(syncConnectorToolsById('c1', ctx, { linkId: 'lnk_b' })).rejects.toThrow(
        'unauthorized',
      );

      expect(connectorLinkModel.updateStatus).toHaveBeenCalledExactlyOnceWith(
        'c1',
        'lnk_b',
        'error',
      );
      expect(connectorModel.updateStatus).not.toHaveBeenCalled();
      expect(connectorToolModel.upsertMany).not.toHaveBeenCalled();
    });

    it('marks the connector failed too when the failing account is its only one', async () => {
      vi.mocked(mcpService.listRawTools).mockRejectedValue(new Error('unauthorized'));
      const { connectorLinkModel, connectorModel, ctx } = setup([account('lnk_a', 'token-a')]);

      await expect(syncConnectorToolsById('c1', ctx)).rejects.toThrow('unauthorized');

      expect(connectorLinkModel.updateStatus).toHaveBeenCalledWith('c1', 'lnk_a', 'error');
      expect(connectorModel.updateStatus).toHaveBeenCalledWith('c1', 'error');
    });

    it('refuses an account the connector no longer has before listing', async () => {
      vi.mocked(mcpService.listRawTools).mockClear();
      const { ctx } = setup([account('lnk_a', 'token-a')]);

      await expect(syncConnectorToolsById('c1', ctx, { linkId: 'lnk_gone' })).rejects.toThrow(
        'Connector account no longer exists',
      );
      expect(mcpService.listRawTools).not.toHaveBeenCalled();
    });
  });
});

describe('events capability synchronization', () => {
  it('persists server support without losing connector metadata', async () => {
    webhookEnabled.mockResolvedValueOnce(true);
    vi.mocked(mcpService.listRawTools).mockResolvedValue([]);
    vi.mocked(mcpService.getEventsCapability).mockResolvedValue({ supported: true });
    const update = vi.fn();
    await syncConnectorToolsById('c1', {
      connectorModel: {
        findById: async () => httpConnector(null, { description: 'keep', capabilities: {} }),
        updateStatus: vi.fn(),
        update,
      } as any,
      connectorToolModel: { queryByConnector: async () => [], upsertMany: vi.fn() } as any,
      userId: 'events-user',
    });
    expect(update).toHaveBeenCalledWith('c1', {
      metadata: { description: 'keep', capabilities: { events: { supported: true } } },
    });
  });

  it('marks a connector that runs through a device as without events, without asking it', async () => {
    gateway.isConfigured = true;
    webhookEnabled.mockResolvedValueOnce(true);
    vi.mocked(listMcpToolsOnDevice).mockResolvedValue([]);
    vi.mocked(mcpService.getEventsCapability).mockClear();
    vi.mocked(mcpService.listRawTools).mockClear();
    const update = vi.fn();
    try {
      await syncConnectorToolsById('c1', {
        connectorModel: {
          findById: async () =>
            ({
              credentials: null,
              id: 'c1',
              identifier: 'local-conn',
              isEnabled: true,
              mcpConnectionType: 'stdio',
              mcpServerUrl: null,
              mcpStdioConfig: { args: ['serve'], command: 'my-mcp' },
              metadata: { capabilities: { events: { supported: true } } },
              name: 'Local Connector',
              oidcConfig: null,
              userId: 'owner',
              workspaceId: null,
            }) as any,
          // A personal row is read in its own scope (here: this model)
          forRow() {
            return this;
          },
          update,
          updateStatus: vi.fn(),
        } as any,
        connectorToolModel: { queryByConnector: async () => [], upsertMany: vi.fn() } as any,
        serverDB: {} as any,
        userId: 'owner',
      });
    } finally {
      gateway.isConfigured = false;
    }
    expect(mcpService.listRawTools).not.toHaveBeenCalled();
    expect(mcpService.getEventsCapability).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('c1', {
      metadata: { capabilities: { events: { supported: false } } },
    });
  });
});
