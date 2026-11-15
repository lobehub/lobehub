// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import { ToolExecutionService } from '../index';

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeMcpCall: vi.fn(),
    isConfigured: true,
    queryDeviceList: vi.fn().mockResolvedValue([]),
    readDeviceSystemInfo: vi.fn().mockResolvedValue({ ok: true, systemInfo: {} }),
  },
}));
vi.mock('@/server/services/mcp/featureGate', () => ({
  isMcpAppsEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: vi.fn().mockResolvedValue([]),
}));

/** A device-only MCP server bound to one device runs there and nowhere else. */
describe('ToolExecutionService — MCP bound to a device', () => {
  const makeService = () =>
    new ToolExecutionService({
      builtinToolsExecutor: { execute: vi.fn() } as any,
      mcpService: { callTool: vi.fn() } as any,
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
    vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
      content: 'ok',
      success: true,
    } as any);
  });

  const stdio = { args: [], command: 'npx', name: 'my-mcp', type: 'stdio' };

  it("tunnels to the bound device, not the run's device or a newer one", async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      { channels: [{ channel: 'desktop' }], deviceId: 'newest', online: true },
      { channels: [{ channel: 'desktop' }], deviceId: 'nas-box', online: true },
    ] as any);
    const service = makeService();

    const result = await service.executeTool(
      mcpPayload,
      contextWith(
        { ...stdio, boundDevice: { deviceId: 'nas-box' } },
        { activeDeviceId: 'run-device' },
      ),
    );

    expect(result.success).toBe(true);
    expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'nas-box', workspaceId: undefined }),
      undefined,
    );
  });

  it("addresses the bound workspace device under the connector's workspace in a run with no device", async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      { channels: [{ channel: 'desktop' }], deviceId: 'ws-nas', online: true },
    ] as any);
    const service = makeService();

    const result = await service.executeTool(
      mcpPayload,
      contextWith(
        { ...stdio, boundDevice: { deviceId: 'ws-nas', workspaceId: 'ws-1' } },
        { workspaceId: 'ws-1' },
      ),
    );

    expect(result.success).toBe(true);
    expect(getScopedOnlineDevices).toHaveBeenCalledWith({}, 'user-1', 'ws-1');
    expect(deviceGateway.executeMcpCall).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'ws-nas', workspaceId: 'ws-1' }),
      undefined,
    );
  });

  it('fails with the reason instead of falling back when the bound device is offline', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      { channels: [{ channel: 'desktop' }], deviceId: 'laptop', online: true },
      { deviceId: 'nas-box', friendlyName: 'Office NAS', online: false },
    ] as any);
    const service = makeService();

    const result = await service.executeTool(
      mcpPayload,
      contextWith({ ...stdio, boundDevice: { deviceId: 'nas-box' } }, { activeDeviceId: 'laptop' }),
    );

    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect((result.error as any)?.code).toBe('MCP_BOUND_DEVICE_UNAVAILABLE');
    expect(result.content).toContain('"Office NAS", which is offline');
  });
});
