// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';

import { ToolExecutionService } from '../index';

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeMcpCall: vi.fn(),
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
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
      vi.mocked(deviceGateway.queryDeviceList).mockResolvedValue([]);
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

    it('falls back to the most recently active device for chat-mode runs (no plan device)', async () => {
      vi.mocked(deviceGateway.queryDeviceList).mockResolvedValue([
        { deviceId: 'older', lastSeen: '2026-01-01T00:00:00Z' },
        { deviceId: 'newest', lastSeen: '2026-06-01T00:00:00Z' },
      ] as any);
      const service = makeService();

      await service.executeTool(
        mcpPayload,
        contextWith({ args: [], command: 'npx', name: 'my-mcp', type: 'stdio' }),
      );

      expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'newest' }),
        undefined,
      );
    });

    it('addresses the workspace device pool for a workspace-scoped run', async () => {
      // Workspace devices live under the `workspace:<id>` principal in the
      // gateway — both device lookup and the tunneled call must carry the scope
      // or an online workspace-shared device would be missed.
      vi.mocked(deviceGateway.queryDeviceList).mockResolvedValue([
        { deviceId: 'ws-device', lastSeen: '2026-06-01T00:00:00Z' },
      ] as any);
      const service = makeService();

      await service.executeTool(
        mcpPayload,
        contextWith(
          { args: [], command: 'npx', name: 'my-mcp', type: 'stdio' },
          { workspaceId: 'ws-1' },
        ),
      );

      expect(deviceGateway.queryDeviceList).toHaveBeenCalledWith('user-1', 'ws-1');
      expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'ws-device', workspaceId: 'ws-1' }),
        undefined,
      );
    });

    it('addresses the personal pool for a personal-scope active device in a workspace run', async () => {
      // LOBE-11689: a workspace agent routed to the caller's own machine has no
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

    it('falls through to the in-process call when no device is reachable', async () => {
      const callTool = vi.fn().mockResolvedValue({ ok: true });
      const service = makeService({ callTool });

      await service.executeTool(
        mcpPayload,
        contextWith({ name: 'my-mcp', type: 'http', url: 'http://localhost:8080/mcp' }),
      );

      expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
      expect(callTool).toHaveBeenCalledTimes(1);
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
