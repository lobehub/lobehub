import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeviceMcpManifest } from './deviceManifest';
import {
  listMcpToolsOnDevice,
  McpBoundDeviceUnavailableError,
  McpDeviceUnavailableError,
} from './deviceTunnel';

const gateway = vi.hoisted(() => ({ isConfigured: true }));

vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: gateway }));
vi.mock('@/server/services/mcp/featureGate', () => ({
  isMcpAppsEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/server/services/mcp', () => ({
  mcpService: {
    buildStreamableMcpManifest: vi.fn((identifier: string, _p, tools: unknown[]) => ({
      api: tools,
      identifier,
    })),
    listRawTools: vi.fn(),
  },
}));
vi.mock('./deviceTunnel', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  listMcpToolsOnDevice: vi.fn(),
}));

const serverDB = {} as never;
const connection = {
  auth: { token: 'secret', type: 'bearer' as const },
  identifier: 'nas',
  url: 'https://nas.tail1234.ts.net/mcp',
};
const tools = [{ inputSchema: { type: 'object' }, name: 'list_files' }];

describe('getDeviceMcpManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateway.isConfigured = true;
  });

  it("lists the tools on the user's desktop app and maps them into a manifest", async () => {
    const { mcpService } = await import('@/server/services/mcp');
    vi.mocked(listMcpToolsOnDevice).mockResolvedValue(tools as never);

    await expect(getDeviceMcpManifest({ connection, serverDB, userId: 'u1' })).resolves.toEqual({
      api: tools,
      identifier: 'nas',
    });

    expect(listMcpToolsOnDevice).toHaveBeenCalledWith({
      mcpApps: true,
      params: {
        auth: connection.auth,
        connectVia: 'device',
        name: 'nas',
        type: 'http',
        url: connection.url,
      },
      serverDB,
      userId: 'u1',
    });
    // Never connected from the server
    expect(mcpService.listRawTools).not.toHaveBeenCalled();
  });

  it('connects from the server itself when it has no device gateway (self-hosted)', async () => {
    const { mcpService } = await import('@/server/services/mcp');
    gateway.isConfigured = false;
    vi.mocked(mcpService.listRawTools).mockResolvedValue(tools as never);

    await getDeviceMcpManifest({ connection, serverDB, userId: 'u1' });

    expect(mcpService.listRawTools).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'nas', url: connection.url }),
      { mcpApps: true },
    );
    expect(listMcpToolsOnDevice).not.toHaveBeenCalled();
  });

  it('fails as a precondition, with what to do, when no desktop app is online', async () => {
    vi.mocked(listMcpToolsOnDevice).mockRejectedValue(new McpDeviceUnavailableError('nas'));

    const error = await getDeviceMcpManifest({ connection, serverDB, userId: 'u1' }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe('PRECONDITION_FAILED');
    expect(error.message).toContain('desktop app');
  });

  it("passes a connection's own TRPC error through with its data", async () => {
    const authError = new TRPCError({ code: 'UNAUTHORIZED', message: 'Reconnect this MCP' });
    vi.mocked(listMcpToolsOnDevice).mockRejectedValue(authError);

    await expect(getDeviceMcpManifest({ connection, serverDB, userId: 'u1' })).rejects.toBe(
      authError,
    );
  });

  it('reports a failed listing on the device as a bad request', async () => {
    vi.mocked(listMcpToolsOnDevice).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      getDeviceMcpManifest({ connection, serverDB, userId: 'u1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'ECONNREFUSED' });
  });

  it("lists on the bound device of the caller's workspace", async () => {
    vi.mocked(listMcpToolsOnDevice).mockResolvedValue(tools as never);

    await getDeviceMcpManifest({
      connection: { ...connection, boundDeviceId: 'nas-box' },
      serverDB,
      userId: 'u1',
      workspaceId: 'ws1',
    });

    expect(listMcpToolsOnDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          boundDevice: { deviceId: 'nas-box', workspaceId: 'ws1' },
          type: 'http',
        }),
      }),
    );
  });

  it('starts a stdio server on its bound device', async () => {
    vi.mocked(listMcpToolsOnDevice).mockResolvedValue(tools as never);

    await expect(
      getDeviceMcpManifest({
        connection: {
          args: ['serve'],
          boundDeviceId: 'build-box',
          command: 'my-mcp',
          identifier: 'local-tool',
          type: 'stdio',
        },
        serverDB,
        userId: 'u1',
      }),
    ).resolves.toMatchObject({ identifier: 'local-tool' });

    expect(listMcpToolsOnDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          args: ['serve'],
          boundDevice: { deviceId: 'build-box' },
          command: 'my-mcp',
          name: 'local-tool',
          type: 'stdio',
        },
      }),
    );
  });

  it('fails as a precondition when the bound device is offline', async () => {
    vi.mocked(listMcpToolsOnDevice).mockRejectedValue(
      new McpBoundDeviceUnavailableError('nas', 'offline', 'Office NAS'),
    );

    await expect(
      getDeviceMcpManifest({
        connection: { ...connection, boundDeviceId: 'nas-box' },
        serverDB,
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
