// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import { ToolExecutionService } from '../index';

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeMcpCall: vi.fn(),
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));
// The tunnel fallback must use the visibility-aware scoped helper, never the
// raw (visibility-blind) gateway pool — see resolveMcpTunnelTarget.
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: vi.fn().mockResolvedValue([]),
}));

describe('ToolExecutionService', () => {
  it('can skip low-level result truncation for AgentRuntime archival', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'search',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'lobe-web-browsing',
        type: 'builtin',
      },
      {
        skipResultTruncation: true,
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toBe('0123456789');
  });

  it('keeps existing low-level truncation by default', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'search',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'lobe-web-browsing',
        type: 'builtin',
      },
      {
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toContain('01234');
    expect(result.content).toContain('Content truncated');
  });

  // Device-only MCP servers (stdio / localhost / LAN) can't be called from the
  // cloud — with a device gateway configured, those calls must tunnel to the
  // user's device instead of failing with a spawn/fetch error (#16533).
  describe('device-only MCP tunneling', () => {
    const makeService = (mcpService: any = { callTool: vi.fn() }) =>
      new ToolExecutionService({
        builtinToolsExecutor: { execute: vi.fn() } as any,
        mcpService,
      });

    const mcpPayload = {
      apiName: 'do_thing',
      arguments: '{}',
      id: 'tool-call-1',
      identifier: 'my-mcp',
      type: 'mcp',
    } as any;

    const contextWith = (mcpParams: Record<string, unknown>, over: Record<string, unknown> = {}) =>
      ({
        serverDB: {},
        toolManifestMap: { 'my-mcp': { mcpParams } },
        userId: 'user-1',
        ...over,
      }) as any;

    beforeEach(() => {
      vi.clearAllMocks();
      (deviceGateway as any).isConfigured = true;
      vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
        content: 'ok',
        success: true,
      } as any);
      vi.mocked(getScopedOnlineDevices).mockResolvedValue([]);
    });

    it('tunnels a stdio MCP call to the plan-routed device', async () => {
      const service = makeService();
      const result = await service.executeTool(
        mcpPayload,
        contextWith(
          { args: ['-y', 'mcp-server'], command: 'npx', name: 'my-mcp', type: 'stdio' },
          { activeDeviceId: 'device-1' },
        ),
      );

      expect(result.success).toBe(true);
      expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'device-1',
          params: expect.objectContaining({ command: 'npx', type: 'stdio' }),
        }),
        undefined,
      );
    });

    it('tunnels a local-network HTTP MCP call and narrows the auth payload', async () => {
      const service = makeService();
      await service.executeTool(
        mcpPayload,
        contextWith(
          {
            auth: {
              accessToken: 'at',
              clientSecret: 'SECRET',
              refreshToken: 'REFRESH',
              type: 'oauth2',
            },
            name: 'my-mcp',
            type: 'http',
            url: 'http://192.168.1.10:8080/mcp',
          },
          { activeDeviceId: 'device-1' },
        ),
      );

      const call = vi.mocked(deviceGateway.executeMcpCall).mock.calls[0][0];
      expect(call.params).toEqual({
        auth: { accessToken: 'at', token: undefined, type: 'oauth2' },
        headers: undefined,
        name: 'my-mcp',
        type: 'http',
        url: 'http://192.168.1.10:8080/mcp',
      });
    });

    it('falls back to the first online scoped personal device for chat-mode runs (no plan device)', async () => {
      // getScopedOnlineDevices returns online-first / most-recently-active
      // order and includes offline DB rows — the fallback must skip those.
      vi.mocked(getScopedOnlineDevices).mockResolvedValue([
        { channels: [{ channel: 'desktop' }], deviceId: 'offline-row', online: false },
        // A newer CLI-only connection must be skipped: the CLI's
        // tool_call_request handler cannot execute `mcp` calls.
        { channels: [{ channel: 'cli' }], deviceId: 'cli-only', online: true },
        {
          channels: [{ channel: 'cli' }, { channel: 'desktop' }],
          deviceId: 'newest',
          online: true,
        },
        { channels: [{ channel: 'desktop' }], deviceId: 'older', online: true },
      ] as any);
      const service = makeService();
      const context = contextWith({ args: [], command: 'npx', name: 'my-mcp', type: 'stdio' });

      await service.executeTool(mcpPayload, context);

      expect(getScopedOnlineDevices).toHaveBeenCalledWith(context.serverDB, 'user-1', undefined);
      expect(deviceGateway.queryDeviceList).not.toHaveBeenCalled();
      expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'newest' }),
        undefined,
      );
    });

    it('addresses the workspace pool for a plan-routed device in a workspace run', async () => {
      // Workspace devices live under the `workspace:<id>` principal in the
      // gateway — the tunneled call must carry the scope or an online
      // workspace device would be missed.
      const service = makeService();

      await service.executeTool(
        mcpPayload,
        contextWith(
          { args: [], command: 'npx', name: 'my-mcp', type: 'stdio' },
          { activeDeviceId: 'ws-device', workspaceId: 'ws-1' },
        ),
      );

      expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'ws-device', workspaceId: 'ws-1' }),
        undefined,
      );
    });

    it('fails closed for a workspace run with no plan-routed device', async () => {
      // The connector may have been authorized by ANOTHER member — tunneling
      // its credentials to the caller's own newest device would leak them to a
      // machine the authorizer never approved. No implicit fallback in
      // workspace scope.
      vi.mocked(getScopedOnlineDevices).mockResolvedValue([
        { deviceId: 'caller-device', online: true },
      ] as any);
      const service = makeService();

      const result = await service.executeTool(
        mcpPayload,
        contextWith(
          { args: [], command: 'npx', name: 'my-mcp', type: 'stdio' },
          { workspaceId: 'ws-1' },
        ),
      );

      expect(getScopedOnlineDevices).not.toHaveBeenCalled();
      expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect((result.error as any)?.code).toBe('MCP_DEVICE_UNAVAILABLE');
    });

    it('addresses the personal pool for a personal-scope active device in a workspace run', async () => {
      // per-user agent device override in workspace: a workspace agent routed to the caller's own machine has no
      // connection under the workspace principal — a workspace-addressed call
      // would miss it.
      const service = makeService();

      await service.executeTool(
        mcpPayload,
        contextWith(
          { args: [], command: 'npx', name: 'my-mcp', type: 'stdio' },
          { activeDeviceId: 'device-1', activeDeviceScope: 'personal', workspaceId: 'ws-1' },
        ),
      );

      expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'device-1', workspaceId: undefined }),
        undefined,
      );
    });

    it('keeps public HTTP MCP calls in-process on the server', async () => {
      const callTool = vi.fn().mockResolvedValue({ ok: true });
      const service = makeService({ callTool });

      await service.executeTool(
        mcpPayload,
        contextWith(
          { name: 'my-mcp', type: 'http', url: 'https://mcp.example.com' },
          { activeDeviceId: 'device-1' },
        ),
      );

      expect(callTool).toHaveBeenCalledTimes(1);
      expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
    });

    it('fails fast when no device is reachable instead of executing on the server', async () => {
      // With a gateway configured (cloud), a device-only endpoint must never
      // run in-process — that would spawn the command / fetch the private URL
      // on the cloud server, bypassing the classic-path device-only guard.
      const callTool = vi.fn().mockResolvedValue({ ok: true });
      const service = makeService({ callTool });

      const result = await service.executeTool(
        mcpPayload,
        contextWith({ name: 'my-mcp', type: 'http', url: 'http://localhost:8080/mcp' }),
      );

      expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
      expect(callTool).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect((result.error as any)?.code).toBe('MCP_DEVICE_UNAVAILABLE');
    });

    it('fails closed when no serverDB is available to apply device visibility', async () => {
      // Without a DB the scoped helper cannot apply device visibility — never
      // fall back to a raw gateway lookup.
      const service = makeService();

      const result = await service.executeTool(
        mcpPayload,
        contextWith(
          { args: [], command: 'npx', name: 'my-mcp', type: 'stdio' },
          { serverDB: undefined },
        ),
      );

      expect(getScopedOnlineDevices).not.toHaveBeenCalled();
      expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect((result.error as any)?.code).toBe('MCP_DEVICE_UNAVAILABLE');
    });

    it('runs stdio in-process when no gateway is configured (standalone Electron)', async () => {
      (deviceGateway as any).isConfigured = false;
      const callTool = vi.fn().mockResolvedValue({ ok: true });
      const service = makeService({ callTool });

      await service.executeTool(
        mcpPayload,
        contextWith(
          { args: [], command: 'npx', name: 'my-mcp', type: 'stdio' },
          { activeDeviceId: 'device-1' },
        ),
      );

      expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
      expect(callTool).toHaveBeenCalledTimes(1);
    });
  });
});
