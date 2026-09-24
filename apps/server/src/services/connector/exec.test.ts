import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorToolPermission } from '@/database/schemas';
import { deviceGateway } from '@/server/services/deviceGateway';
import { mcpService } from '@/server/services/mcp';

import { callConnectorToolById } from './exec';
import { scheduleStaleConnectorToolsRefresh } from './refresh';
import { ensureFreshConnectorToken } from './tokens';

vi.mock('@/server/services/mcp', () => ({ mcpService: { callTool: vi.fn() } }));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeMcpCall: vi.fn(),
    isConfigured: false,
    queryDeviceList: vi.fn(),
  },
}));
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

const makeCtx = (connectors: any[], tools: any[], extra: Record<string, unknown> = {}) =>
  ({
    connectorModel: { queryByIdentifiers: vi.fn().mockResolvedValue(connectors) },
    connectorToolModel: { queryByConnector: vi.fn().mockResolvedValue(tools) },
    userId: 'u1',
    ...extra,
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureFreshConnectorToken).mockImplementation(async (c: any) => c);
  (deviceGateway as any).isConfigured = false;
  vi.mocked(deviceGateway.queryDeviceList).mockResolvedValue([
    { deviceId: 'dev-1', online: true },
  ] as any);
  vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
    content: 'device-ok',
    state: {},
    success: true,
  });
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

  // Device-only endpoints (stdio or local network URLs):
  // When device gateway is configured, tunnel the MCP call to the active desktop device.
  // When device gateway is not configured, fail fast for stdio while letting self-hosted
  // LAN HTTP endpoints pass through.
  describe('device-only endpoints on a cloud deployment', () => {
    it('tunnels a stdio connector to the online device when the device gateway is configured', async () => {
      (deviceGateway as any).isConfigured = true;
      const stdioConnector = {
        ...connector,
        mcpConnectionType: 'stdio',
        mcpServerUrl: null,
        mcpStdioConfig: { args: ['-y'], command: 'npx', env: { FOO: 'bar' } },
      };
      const ctx = makeCtx([stdioConnector], [tool()]);

      const res = await callConnectorToolById(
        { args: '{"x":1}', identifier: 'my-conn', toolName: 'do_thing' },
        ctx,
      );

      expect(res).toEqual({ content: 'device-ok', state: {}, success: true });
      expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith({
        apiName: 'do_thing',
        arguments: '{"x":1}',
        deviceId: 'dev-1',
        identifier: 'my-conn',
        params: expect.objectContaining({
          args: ['-y'],
          command: 'npx',
          type: 'stdio',
        }),
        userId: 'u1',
        workspaceId: undefined,
      });
      expect(mcpService.callTool).not.toHaveBeenCalled();
    });

    it('tunnels a local/private-network HTTP connector to the online device when the device gateway is configured', async () => {
      (deviceGateway as any).isConfigured = true;
      const localConnector = { ...connector, mcpServerUrl: 'http://192.168.1.10:8080/mcp' };
      const ctx = makeCtx([localConnector], [tool()]);

      const res = await callConnectorToolById(
        { args: '{"x":1}', identifier: 'my-conn', toolName: 'do_thing' },
        ctx,
      );

      expect(res).toEqual({ content: 'device-ok', state: {}, success: true });
      expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith(
        expect.objectContaining({
          apiName: 'do_thing',
          deviceId: 'dev-1',
          identifier: 'my-conn',
          params: expect.objectContaining({
            type: 'http',
            url: 'http://192.168.1.10:8080/mcp',
          }),
        }),
      );
      expect(mcpService.callTool).not.toHaveBeenCalled();
    });

    it('rejects a stdio connector when device gateway is configured but no device is online', async () => {
      (deviceGateway as any).isConfigured = true;
      vi.mocked(deviceGateway.queryDeviceList).mockResolvedValue([]);
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
      expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
    });

    it('rejects a stdio connector when device gateway is not configured', async () => {
      (deviceGateway as any).isConfigured = false;
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
      expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
      expect(mcpService.callTool).not.toHaveBeenCalled();
    });

    it('throws when device tool execution returns failure', async () => {
      (deviceGateway as any).isConfigured = true;
      vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
        content: 'failed on mac',
        error: 'EXEC_ERROR',
        success: false,
      });
      const stdioConnector = {
        ...connector,
        mcpConnectionType: 'stdio',
        mcpServerUrl: null,
        mcpStdioConfig: { args: [], command: 'npx' },
      };
      const ctx = makeCtx([stdioConnector], [tool()]);

      await expect(
        callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
      ).rejects.toThrow('EXEC_ERROR');
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
      throw new Error('boom');
    });
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
    const ctx = makeCtx([connector], [tool()]);

    const res = await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

    expect(res).toEqual({ success: true });
  });
});
