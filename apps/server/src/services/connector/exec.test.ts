import { getMcpServerFingerprint } from '@lobechat/const/mcpApp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorToolPermission } from '@/database/schemas';
import { deviceGateway } from '@/server/services/deviceGateway';
import { mcpService } from '@/server/services/mcp';
import type * as ContentProcessorModule from '@/server/services/mcp/contentProcessor';

import { callConnectorToolById, readConnectorUiResourceById } from './exec';
import { scheduleStaleConnectorToolsRefresh } from './refresh';
import { ensureFreshConnectorToken } from './tokens';

vi.mock('@/server/services/mcp', () => ({
  mcpService: { callTool: vi.fn(), readUiResource: vi.fn() },
}));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: { isConfigured: false } }));
const callCloudMcpEndpoint = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn(function DiscoverService() {
    return { callCloudMcpEndpoint };
  }),
}));
const processContentBlocks = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/mcp/contentProcessor', async (importOriginal) => ({
  ...(await importOriginal<typeof ContentProcessorModule>()),
  processContentBlocks,
}));
const mcpAppsEnabled = vi.hoisted(() => vi.fn().mockResolvedValue(false));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppsEnabled: mcpAppsEnabled }));
vi.mock('./tokens', () => ({ ensureFreshConnectorToken: vi.fn(async (c) => c) }));
// The background tool-list refresh is exercised in refresh.test.ts. Here we only
// verify the call site wires it up and stays isolated from it.
vi.mock('./refresh', () => ({
  buildLastSyncedAtMap: vi.fn(() => new Map()),
  scheduleStaleConnectorToolsRefresh: vi.fn(),
}));

const connector = {
  credentials: { accessToken: 'tok', type: 'oauth2' },
  id: 'c1',
  identifier: 'my-conn',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example.com',
  mcpStdioConfig: null,
  name: 'My Connector',
  oidcConfig: null,
} as any;

const tool = (over: Record<string, unknown> = {}) => ({
  permission: ConnectorToolPermission.auto,
  toolName: 'do_thing',
  ...over,
});

const makeCtx = (connectors: any[], tools: any[], { agentVisible = true } = {}) =>
  ({
    agentModel: { existsById: vi.fn().mockResolvedValue(agentVisible) },
    connectorModel: {
      queryByIdentifiers: vi.fn().mockResolvedValue(connectors),
      resolveByIdentifiers: vi.fn().mockResolvedValue(connectors),
    },
    connectorToolModel: { queryByConnector: vi.fn().mockResolvedValue(tools) },
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mcpAppsEnabled.mockResolvedValue(false);
  vi.mocked(ensureFreshConnectorToken).mockImplementation(async (c: any) => c);
  (deviceGateway as any).isConfigured = false;
});

describe('callConnectorToolById', () => {
  it('rejects when the connector is not found', async () => {
    await expect(
      callConnectorToolById({ identifier: 'x', toolName: 'do_thing' }, makeCtx([], [])),
    ).rejects.toHaveProperty('code', 'NOT_FOUND');
  });

  it('rejects when the connector is disabled', async () => {
    const ctx = makeCtx([{ ...connector, isEnabled: false }], [tool()]);
    await expect(
      callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  describe('an unfinished marketplace install', () => {
    // A reinstall over a plugin row rewrites the endpoint and resets the row to
    // disconnected until its tools sync: the old tool rows must not run on it
    const pending = {
      ...connector,
      metadata: {},
      sourceType: 'marketplace',
      status: 'disconnected',
    };
    const call = (row: any, pluginRow?: unknown) =>
      callConnectorToolById(
        { identifier: 'my-conn', toolName: 'do_thing' },
        {
          ...makeCtx([row], [tool()]),
          pluginModel: { findById: vi.fn().mockResolvedValue(pluginRow) },
        },
      );

    it('refuses a pending reinstall over a plugin row', async () => {
      await expect(call(pending, { identifier: 'my-conn' })).rejects.toHaveProperty(
        'code',
        'FORBIDDEN',
      );
      expect(mcpService.callTool).not.toHaveBeenCalled();
    });

    it('refuses a connected row with neither its install mark nor a plugin row', async () => {
      await expect(call({ ...pending, status: 'connected' })).rejects.toHaveProperty(
        'code',
        'FORBIDDEN',
      );
      expect(mcpService.callTool).not.toHaveBeenCalled();
    });

    it('runs a connected row once a plugin row or its install mark finishes it', async () => {
      vi.mocked(mcpService.callTool).mockResolvedValue({ ok: true } as any);

      await call({ ...pending, status: 'connected' }, { identifier: 'my-conn' });
      await call({ ...pending, metadata: { marketplaceInstalled: true }, status: 'connected' });

      expect(mcpService.callTool).toHaveBeenCalledTimes(2);
    });
  });

  it('rejects an unknown tool name not in the synced list', async () => {
    const ctx = makeCtx([connector], [tool({ toolName: 'other' })]);
    await expect(
      callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
    ).rejects.toHaveProperty('code', 'BAD_REQUEST');
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it('rejects a disabled tool', async () => {
    const ctx = makeCtx([connector], [tool({ permission: ConnectorToolPermission.disabled })]);
    await expect(
      callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it('refuses a model call to a tool only its view may call, and runs the view call', async () => {
    const ctx = makeCtx([connector], [tool({ metadata: { visibility: ['app'] } })]);
    vi.mocked(mcpService.callTool).mockResolvedValue({ content: 'ok' } as any);

    await expect(
      callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(mcpService.callTool).not.toHaveBeenCalled();

    const server = await getMcpServerFingerprint({ type: 'http', url: connector.mcpServerUrl! });
    await callConnectorToolById(
      { fromApp: true, identifier: 'my-conn', server, toolName: 'do_thing' },
      ctx,
    );
    expect(mcpService.callTool).toHaveBeenCalledWith(expect.objectContaining({ fromApp: true }));
  });

  it('calls the remote MCP with the connector auth for an allowed tool', async () => {
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
    const ctx = makeCtx([connector], [tool()]);

    const res = await callConnectorToolById(
      { args: '{"a":1}', identifier: 'my-conn', toolName: 'do_thing' },
      ctx,
    );

    expect(res).toEqual({ success: true });
    expect(mcpService.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        argsStr: '{"a":1}',
        clientParams: expect.objectContaining({
          auth: expect.objectContaining({ accessToken: 'tok', type: 'oauth2' }),
          type: 'http',
          url: 'https://mcp.example.com',
        }),
        toolName: 'do_thing',
      }),
    );
  });

  // Image / audio blocks become the caller's files, as `tools.mcp.callTool` stores them
  it("stores a result's media blocks with the caller's file service", async () => {
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
    const fileService = { uploadMedia: vi.fn() };
    const blocks = [{ data: 'aGk=', mimeType: 'image/png', type: 'image' }];
    processContentBlocks.mockResolvedValue([{ text: 'stored', type: 'text' }]);

    await callConnectorToolById(
      { identifier: 'my-conn', toolName: 'do_thing' },
      { ...makeCtx([connector], [tool()]), fileService },
    );

    const { processContentBlocks: processor } = vi.mocked(mcpService.callTool).mock.calls[0][0];
    expect(processor).toBeTypeOf('function');
    await expect(processor!(blocks as any)).resolves.toEqual([{ text: 'stored', type: 'text' }]);
    expect(processContentBlocks).toHaveBeenCalledWith(blocks, fileService);
  });

  it('formats media blocks as returned when no file service is given', async () => {
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });

    await callConnectorToolById(
      { identifier: 'my-conn', toolName: 'do_thing' },
      makeCtx([connector], [tool()]),
    );

    expect(mcpService.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ processContentBlocks: undefined }),
    );
  });

  it.each([true, false])('passes the caller mcp_apps flag (%s) through', async (enabled) => {
    mcpAppsEnabled.mockResolvedValueOnce(enabled);
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
    const ctx = { ...makeCtx([connector], [tool()]), userId: 'user-1' };

    await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

    expect(mcpAppsEnabled).toHaveBeenCalledWith('user-1');
    expect(mcpService.callTool).toHaveBeenCalledWith(expect.objectContaining({ mcpApps: enabled }));
  });

  it.each([true, undefined])(
    'passes whether a view made the call (%s) through',
    async (fromApp) => {
      vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
      const ctx = makeCtx([connector], [tool()]);

      const server = await getMcpServerFingerprint({ type: 'http', url: connector.mcpServerUrl! });
      await callConnectorToolById(
        { fromApp, identifier: 'my-conn', server, toolName: 'do_thing' },
        ctx,
      );

      expect(mcpService.callTool).toHaveBeenCalledWith(expect.objectContaining({ fromApp }));
    },
  );

  it("refuses a view's call once only the connector's routing headers changed", async () => {
    const server = await getMcpServerFingerprint({ type: 'http', url: connector.mcpServerUrl! });
    const retargeted = { ...connector, metadata: { customHeaders: { 'X-Tenant': 'b' } } };

    await expect(
      callConnectorToolById(
        { fromApp: true, identifier: 'my-conn', server, toolName: 'do_thing' },
        makeCtx([retargeted], [tool()]),
      ),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it("refuses a view's call once the connector reaches another server than the view's", async () => {
    const ctx = makeCtx([connector], [tool()]);
    const other = await getMcpServerFingerprint({ type: 'http', url: 'https://old.example.com' });

    for (const server of [other, undefined]) {
      await expect(
        callConnectorToolById(
          { fromApp: true, identifier: 'my-conn', server, toolName: 'do_thing' },
          ctx,
        ),
      ).rejects.toHaveProperty('code', 'FORBIDDEN');
    }
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it('uses the refreshed token when the connector token was refreshed', async () => {
    vi.mocked(ensureFreshConnectorToken).mockResolvedValueOnce({
      ...connector,
      credentials: { accessToken: 'refreshed', type: 'oauth2' },
    } as any);
    vi.mocked(mcpService.callTool).mockResolvedValue({ ok: true });
    const ctx = makeCtx([connector], [tool()]);

    await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

    expect(mcpService.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        clientParams: expect.objectContaining({
          auth: expect.objectContaining({ accessToken: 'refreshed' }),
        }),
      }),
    );
  });

  it('schedules a background tool-list refresh for the connector', async () => {
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
    const ctx = makeCtx([connector], [tool()]);

    await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

    expect(scheduleStaleConnectorToolsRefresh).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'c1',
          mcpConnectionType: 'http',
          mcpServerUrl: 'https://mcp.example.com',
        }),
      ],
      expect.anything(),
      ctx,
    );
  });

  // Stdio is always device-only. Private HTTP is device-only when a gateway
  // is configured; self-hosted servers without one can still access their LAN.
  describe('device-only endpoints', () => {
    it.each([false, true])(
      'rejects a stdio connector with gateway configured: %s',
      async (configured) => {
        (deviceGateway as any).isConfigured = configured;
        const stdioConnector = {
          ...connector,
          mcpConnectionType: 'stdio',
          mcpServerUrl: null,
          mcpStdioConfig: { args: [], command: 'npx' },
        };
        const ctx = makeCtx([stdioConnector], [tool()]);

        await expect(
          callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
        ).rejects.toHaveProperty('code', 'BAD_REQUEST');
        expect(mcpService.callTool).not.toHaveBeenCalled();
      },
    );

    it('rejects a local/private-network HTTP connector when the device gateway is configured', async () => {
      (deviceGateway as any).isConfigured = true;
      const localConnector = { ...connector, mcpServerUrl: 'http://192.168.1.10:8080/mcp' };
      const ctx = makeCtx([localConnector], [tool()]);

      await expect(
        callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
      ).rejects.toHaveProperty('code', 'BAD_REQUEST');
      expect(mcpService.callTool).not.toHaveBeenCalled();
    });

    it('still calls a local endpoint when no device gateway is configured (self-host)', async () => {
      vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
      const localConnector = { ...connector, mcpServerUrl: 'http://192.168.1.10:8080/mcp' };
      const ctx = makeCtx([localConnector], [tool()]);

      const res = await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

      expect(res).toEqual({ success: true });
      expect(mcpService.callTool).toHaveBeenCalledTimes(1);
    });

    it('keeps calling public endpoints when the device gateway is configured', async () => {
      (deviceGateway as any).isConfigured = true;
      vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
      const ctx = makeCtx([connector], [tool()]);

      const res = await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

      expect(res).toEqual({ success: true });
    });
  });

  describe('cloud connectors', () => {
    const cloud = {
      ...connector,
      credentials: null,
      mcpConnectionType: 'cloud',
      mcpServerUrl: null,
    };
    const fileService = { name: 'fileService' };
    const cloudCtx = (caller: unknown) => ({
      ...makeCtx([cloud], [tool()]),
      resolveCloudMcpCaller: vi.fn().mockResolvedValue(caller),
      userId: 'user-1',
    });

    it('runs the tool through the market cloud gateway with the Market token', async () => {
      callCloudMcpEndpoint.mockResolvedValue({ content: [{ text: 'found', type: 'text' }] });
      processContentBlocks.mockImplementation(async (blocks) => blocks);
      const ctx = cloudCtx({
        discoverService: { callCloudMcpEndpoint },
        fileService,
        userAccessToken: 'market-token',
      });

      const res = await callConnectorToolById(
        { args: '{"q":"x"}', identifier: 'my-conn', toolName: 'do_thing' },
        ctx,
      );

      expect(callCloudMcpEndpoint).toHaveBeenCalledWith({
        apiParams: { q: 'x' },
        identifier: 'my-conn',
        toolName: 'do_thing',
        userAccessToken: 'market-token',
      });
      expect(res).toMatchObject({ content: 'found', success: true });
      expect(mcpService.callTool).not.toHaveBeenCalled();
      expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    });

    it('stores media blocks before formatting the result', async () => {
      const image = { data: 'iVBORw0KGgo', mimeType: 'image/png', type: 'image' };
      const stored = {
        data: 'https://files.example.com/a.png',
        mimeType: 'image/png',
        type: 'image',
      };
      callCloudMcpEndpoint.mockResolvedValue({ content: [image] });
      processContentBlocks.mockResolvedValue([stored]);
      const ctx = cloudCtx({ discoverService: { callCloudMcpEndpoint }, fileService });

      const res = (await callConnectorToolById(
        { identifier: 'my-conn', toolName: 'do_thing' },
        ctx,
      )) as { content: string; state: { content: unknown[] } };

      expect(processContentBlocks).toHaveBeenCalledWith([image], fileService);
      expect(res.content).toBe('![](https://files.example.com/a.png)');
      expect(res.content).not.toContain('iVBOR');
      expect(res.state.content).toEqual([stored]);
    });

    it('refuses the call when there is no Market credential to run it as', async () => {
      const ctx = cloudCtx(undefined);

      await expect(
        callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(callCloudMcpEndpoint).not.toHaveBeenCalled();
    });
  });

  it('still returns the tool result when the background refresh scheduler throws', async () => {
    // The refresh is a pure optimization; a failure in it must never break the
    // tool call the user actually asked for.
    vi.mocked(scheduleStaleConnectorToolsRefresh).mockImplementationOnce(() => {
      throw new Error('scheduler exploded');
    });
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
    const ctx = makeCtx([connector], [tool()]);

    const res = await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

    expect(res).toEqual({ success: true });
    expect(mcpService.callTool).toHaveBeenCalledTimes(1);
  });
});

describe('readConnectorUiResourceById', () => {
  // The server the connector reaches, which the results in these cases came from
  let SERVER: string;

  beforeEach(async () => {
    mcpAppsEnabled.mockResolvedValue(true);
    SERVER = await getMcpServerFingerprint({ type: 'http', url: connector.mcpServerUrl! });
  });

  it('refuses a view whose result came from another server than the connector reaches', async () => {
    const other = await getMcpServerFingerprint({ type: 'http', url: 'https://old.example.com' });

    await expect(
      readConnectorUiResourceById(
        { identifier: 'my-conn', server: other, uri: 'ui://app' },
        makeCtx([connector], []),
      ),
    ).rejects.toHaveProperty('code', 'NOT_FOUND');
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(mcpService.readUiResource).not.toHaveBeenCalled();
  });

  it('refuses to read a view while the mcp_apps flag is off', async () => {
    mcpAppsEnabled.mockResolvedValue(false);
    const ctx = { ...makeCtx([connector], []), userId: 'user-1' };

    await expect(
      readConnectorUiResourceById({ identifier: 'my-conn', server: SERVER, uri: 'ui://app' }, ctx),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');

    expect(mcpAppsEnabled).toHaveBeenCalledWith('user-1');
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(mcpService.readUiResource).not.toHaveBeenCalled();
  });

  it('reads the resource with the connector credentials', async () => {
    vi.mocked(mcpService.readUiResource).mockResolvedValue({ contents: [] } as any);
    const ctx = makeCtx([connector], []);

    await readConnectorUiResourceById(
      { identifier: 'my-conn', server: SERVER, uri: 'ui://app' },
      ctx,
    );

    expect(ensureFreshConnectorToken).toHaveBeenCalledWith(connector, ctx.connectorModel);
    expect(mcpService.readUiResource).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://mcp.example.com' }),
      'ui://app',
    );
  });

  it('rejects missing, disabled, stdio and cloud connectors', async () => {
    await expect(
      readConnectorUiResourceById(
        { identifier: 'x', server: SERVER, uri: 'ui://app' },
        makeCtx([], []),
      ),
    ).rejects.toHaveProperty('code', 'NOT_FOUND');
    await expect(
      readConnectorUiResourceById(
        { identifier: 'my-conn', server: SERVER, uri: 'ui://app' },
        makeCtx([{ ...connector, isEnabled: false }], []),
      ),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    await expect(
      readConnectorUiResourceById(
        { identifier: 'my-conn', server: SERVER, uri: 'ui://app' },
        makeCtx([{ ...connector, mcpConnectionType: 'stdio' }], []),
      ),
    ).rejects.toHaveProperty('code', 'BAD_REQUEST');
    await expect(
      readConnectorUiResourceById(
        { identifier: 'my-conn', server: SERVER, uri: 'ui://app' },
        makeCtx([{ ...connector, mcpConnectionType: 'cloud', mcpServerUrl: null }], []),
      ),
    ).rejects.toHaveProperty('code', 'BAD_REQUEST');
    expect(mcpService.readUiResource).not.toHaveBeenCalled();
  });

  it('resolves the connector for the agent when one is given', async () => {
    vi.mocked(mcpService.readUiResource).mockResolvedValue({ contents: [] } as any);
    const ctx = makeCtx([connector], []);

    await readConnectorUiResourceById(
      { agentId: 'agt_1', identifier: 'my-conn', server: SERVER, uri: 'ui://app' },
      ctx,
    );

    expect(ctx.connectorModel.resolveByIdentifiers).toHaveBeenCalledWith(['my-conn'], 'agt_1');
    expect(ctx.connectorModel.queryByIdentifiers).not.toHaveBeenCalled();
  });

  it('does not fetch a local-network connector from a cloud deployment', async () => {
    (deviceGateway as any).isConfigured = true;

    await expect(
      readConnectorUiResourceById(
        { identifier: 'my-conn', server: SERVER, uri: 'ui://app' },
        makeCtx([{ ...connector, mcpServerUrl: 'http://192.168.1.20:8080/mcp' }], []),
      ),
    ).rejects.toHaveProperty('code', 'BAD_REQUEST');
    expect(mcpService.readUiResource).not.toHaveBeenCalled();
  });
});

describe('callConnectorToolById agent resolution', () => {
  it('resolves the connector for the agent when one is given', async () => {
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true } as any);
    const ctx = makeCtx([connector], [tool()]);

    await callConnectorToolById(
      { agentId: 'agt_1', identifier: 'my-conn', toolName: 'do_thing' },
      ctx,
    );

    expect(ctx.agentModel.existsById).toHaveBeenCalledWith('agt_1');
    expect(ctx.connectorModel.resolveByIdentifiers).toHaveBeenCalledWith(['my-conn'], 'agt_1');
    expect(ctx.connectorModel.queryByIdentifiers).not.toHaveBeenCalled();
  });
});

// Connector rows are scoped by workspace only: another member's private agent
// must not lend its connectors (and their credentials) to the caller.
describe('agent-scoped connectors of an agent the caller cannot see', () => {
  it('does not run a tool on them', async () => {
    const ctx = makeCtx([connector], [tool()], { agentVisible: false });

    await expect(
      callConnectorToolById(
        { agentId: 'agt_private', identifier: 'my-conn', toolName: 'do_thing' },
        ctx,
      ),
    ).rejects.toHaveProperty('code', 'NOT_FOUND');

    expect(ctx.agentModel.existsById).toHaveBeenCalledWith('agt_private');
    expect(ctx.connectorModel.resolveByIdentifiers).not.toHaveBeenCalled();
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it('does not read their views', async () => {
    mcpAppsEnabled.mockResolvedValue(true);
    const ctx = makeCtx([connector], [], { agentVisible: false });

    await expect(
      readConnectorUiResourceById(
        { agentId: 'agt_private', identifier: 'my-conn', server: 'any', uri: 'ui://app' },
        ctx,
      ),
    ).rejects.toHaveProperty('code', 'NOT_FOUND');

    expect(ctx.connectorModel.resolveByIdentifiers).not.toHaveBeenCalled();
    expect(mcpService.readUiResource).not.toHaveBeenCalled();
  });
});
