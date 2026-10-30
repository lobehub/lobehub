import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorToolPermission } from '@/database/schemas';
import { deviceGateway } from '@/server/services/deviceGateway';
import { mcpService } from '@/server/services/mcp';

import { callConnectorToolById, readConnectorUiResourceById } from './exec';
import { scheduleStaleConnectorToolsRefresh } from './refresh';
import { ensureFreshConnectorToken } from './tokens';

vi.mock('@/server/services/mcp', () => ({
  mcpService: { callTool: vi.fn(), readUiResource: vi.fn() },
}));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: { isConfigured: false } }));
const mcpAppEnabled = vi.hoisted(() => vi.fn().mockResolvedValue(false));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppEnabled: mcpAppEnabled }));
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

const makeCtx = (connectors: any[], tools: any[]) =>
  ({
    connectorModel: {
      queryByIdentifiers: vi.fn().mockResolvedValue(connectors),
      resolveByIdentifiers: vi.fn().mockResolvedValue(connectors),
    },
    connectorToolModel: { queryByConnector: vi.fn().mockResolvedValue(tools) },
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mcpAppEnabled.mockResolvedValue(false);
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

  it.each([true, false])('passes the caller mcp_app flag (%s) through', async (enabled) => {
    mcpAppEnabled.mockResolvedValueOnce(enabled);
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
    const ctx = { ...makeCtx([connector], [tool()]), userId: 'user-1' };

    await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

    expect(mcpAppEnabled).toHaveBeenCalledWith('user-1');
    expect(mcpService.callTool).toHaveBeenCalledWith(expect.objectContaining({ mcpApp: enabled }));
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
  beforeEach(() => {
    mcpAppEnabled.mockResolvedValue(true);
  });

  it('refuses to read a view while the mcp_app flag is off', async () => {
    mcpAppEnabled.mockResolvedValue(false);
    const ctx = { ...makeCtx([connector], []), userId: 'user-1' };

    await expect(
      readConnectorUiResourceById({ identifier: 'my-conn', uri: 'ui://app' }, ctx),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');

    expect(mcpAppEnabled).toHaveBeenCalledWith('user-1');
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(mcpService.readUiResource).not.toHaveBeenCalled();
  });

  it('reads the resource with the connector credentials', async () => {
    vi.mocked(mcpService.readUiResource).mockResolvedValue({ contents: [] } as any);
    const ctx = makeCtx([connector], []);

    await readConnectorUiResourceById({ identifier: 'my-conn', uri: 'ui://app' }, ctx);

    expect(ensureFreshConnectorToken).toHaveBeenCalledWith(connector, ctx.connectorModel);
    expect(mcpService.readUiResource).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://mcp.example.com' }),
      'ui://app',
    );
  });

  it('rejects missing, disabled and stdio connectors', async () => {
    await expect(
      readConnectorUiResourceById({ identifier: 'x', uri: 'ui://app' }, makeCtx([], [])),
    ).rejects.toHaveProperty('code', 'NOT_FOUND');
    await expect(
      readConnectorUiResourceById(
        { identifier: 'my-conn', uri: 'ui://app' },
        makeCtx([{ ...connector, isEnabled: false }], []),
      ),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    await expect(
      readConnectorUiResourceById(
        { identifier: 'my-conn', uri: 'ui://app' },
        makeCtx([{ ...connector, mcpConnectionType: 'stdio' }], []),
      ),
    ).rejects.toHaveProperty('code', 'BAD_REQUEST');
    expect(mcpService.readUiResource).not.toHaveBeenCalled();
  });

  it('resolves the connector for the agent when one is given', async () => {
    vi.mocked(mcpService.readUiResource).mockResolvedValue({ contents: [] } as any);
    const ctx = makeCtx([connector], []);

    await readConnectorUiResourceById(
      { agentId: 'agt_1', identifier: 'my-conn', uri: 'ui://app' },
      ctx,
    );

    expect(ctx.connectorModel.resolveByIdentifiers).toHaveBeenCalledWith(['my-conn'], 'agt_1');
    expect(ctx.connectorModel.queryByIdentifiers).not.toHaveBeenCalled();
  });

  it('does not fetch a local-network connector from a cloud deployment', async () => {
    (deviceGateway as any).isConfigured = true;

    await expect(
      readConnectorUiResourceById(
        { identifier: 'my-conn', uri: 'ui://app' },
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

    expect(ctx.connectorModel.resolveByIdentifiers).toHaveBeenCalledWith(['my-conn'], 'agt_1');
    expect(ctx.connectorModel.queryByIdentifiers).not.toHaveBeenCalled();
  });
});
