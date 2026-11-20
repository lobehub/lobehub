// @vitest-environment node
/**
 * T-14043: a connector call that never dialed (no device can run it) and one
 * that dialed and could not reach the MCP server are different failures, with
 * different codes: MCP_DEVICE_UNAVAILABLE vs MCP_ENDPOINT_UNREACHABLE.
 */
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import { ToolExecutionService } from '../index';

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeMcpCall: vi.fn(),
    executeToolCall: vi.fn(),
    isConfigured: false,
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

/** System info from an `lh connect` that runs tunneled MCP calls. */
const mcpCapableCli = { ok: true, systemInfo: { supportedToolCallTypes: ['tool', 'mcp'] } };

describe('MCP connection failures: no device vs unreachable endpoint (T-14043)', () => {
  const mcpPayload = {
    apiName: 'system_info',
    arguments: '{}',
    id: 'tool-call-openwrt',
    identifier: 'openwrt',
    type: 'mcp',
  } as any;
  const lanParams = { name: 'openwrt', type: 'http', url: 'http://192.168.1.1:8080/mcp' };

  beforeEach(() => {
    vi.clearAllMocks();
    (deviceGateway as any).isConfigured = true;
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([]);
  });

  it('no device can run the LAN connector: MCP_DEVICE_UNAVAILABLE, nothing was dialed', async () => {
    const service = new ToolExecutionService({
      builtinToolsExecutor: { execute: vi.fn() } as any,
      mcpService: { callTool: vi.fn() } as any,
    });
    const result = await service.executeTool(mcpPayload, {
      serverDB: {},
      toolManifestMap: { openwrt: { mcpParams: lanParams } },
      userId: 'user-1',
    } as any);
    console.log(
      `[T-14043 server repro] no device bound/online\n  error: ${JSON.stringify(result.error)}`,
    );

    expect(deviceGateway.executeMcpCall).not.toHaveBeenCalled();
    expect(result.error).toMatchObject({ code: 'MCP_DEVICE_UNAVAILABLE' });
  });

  it('the device dialed the server and could not reach it: MCP_ENDPOINT_UNREACHABLE', async () => {
    vi.mocked(deviceGateway.readDeviceSystemInfo).mockResolvedValue(mcpCapableCli as any);
    vi.mocked(deviceGateway.queryDeviceList).mockResolvedValue([
      { channels: [{ channel: 'desktop' }], deviceId: 'router-pc' },
    ] as any);
    // What the gateway client returns after classifyMcpCallReply
    vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
      content:
        'MCP server unreachable at http://192.168.1.1:8080 from this device: there is no network route to the host (EHOSTUNREACH). Make sure the machine making the call is on the same network as the server (LAN, VPN). This is retryable: retry once the server is reachable.\n' +
        '(code: MCP_ENDPOINT_UNREACHABLE, reason: unreachable, cause: EHOSTUNREACH, endpoint: http://192.168.1.1:8080, attempts: 2, probeTimeoutMs: 15000, retryable: true)',
      error: 'MCP_ENDPOINT_UNREACHABLE',
      success: false,
    } as any);
    const service = new ToolExecutionService({
      builtinToolsExecutor: { execute: vi.fn() } as any,
      mcpService: { callTool: vi.fn() } as any,
    });

    const result = await service.executeTool(mcpPayload, {
      activeDeviceId: 'router-pc',
      serverDB: {},
      toolManifestMap: { openwrt: { mcpParams: lanParams } },
      userId: 'user-1',
    } as any);
    console.log(
      `[T-14043 server repro] device could not reach the endpoint\n  error: ${JSON.stringify(result.error)}`,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      attempts: 2,
      causeCode: 'EHOSTUNREACH',
      code: 'MCP_ENDPOINT_UNREACHABLE',
      endpoint: 'http://192.168.1.1:8080',
      reason: 'unreachable',
      retryable: true,
    });
  });

  it('the server dialed a public endpoint and could not reach it: MCP_ENDPOINT_UNREACHABLE with its details', async () => {
    const { McpEndpointUnreachableError } = await import('@lobechat/utils/mcpConnectError');
    const unreachable = new McpEndpointUnreachableError({
      attempts: 2,
      causeCode: 'ECONNREFUSED',
      causeMessage: 'connect ECONNREFUSED 203.0.113.7:443',
      endpoint: 'https://mcp.example.com',
      probeTimeoutMs: 15000,
      reason: 'refused',
      retryable: true,
      via: 'the LobeHub server',
    });
    const service = new ToolExecutionService({
      builtinToolsExecutor: { execute: vi.fn() } as any,
      mcpService: {
        callTool: vi.fn().mockRejectedValue(
          new TRPCError({
            cause: unreachable,
            code: 'INTERNAL_SERVER_ERROR',
            message: unreachable.message,
          }),
        ),
      } as any,
    });

    const result = await service.executeTool(mcpPayload, {
      toolManifestMap: {
        openwrt: {
          mcpParams: { name: 'openwrt', type: 'http', url: 'https://mcp.example.com/mcp' },
        },
      },
      userId: 'user-1',
    } as any);

    expect(result.error).toMatchObject({
      code: 'MCP_ENDPOINT_UNREACHABLE',
      endpoint: 'https://mcp.example.com',
      kind: 'stop',
      reason: 'refused',
      retryable: true,
    });
    expect(result.content).toContain('from the LobeHub server');
  });
});
