import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';
import { resolveDeviceDispatchAuthorizationFailure } from '@/server/services/deviceGateway/dispatchAuthorization';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import {
  listMcpToolsOnDevice,
  McpBoundDeviceUnavailableError,
  McpDeviceUnavailableError,
  resolveBoundMcpDevice,
} from './deviceTunnel';

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: true,
    listMcpTools: vi.fn(),
    queryDeviceList: vi.fn().mockResolvedValue([]),
    readDeviceSystemInfo: vi.fn(),
  },
}));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: vi.fn(),
}));
vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: vi.fn().mockResolvedValue(undefined),
}));

const serverDB = {} as never;
const params = {
  auth: { refreshToken: 'never-leaves', token: 'secret', type: 'bearer' as const },
  name: 'nas',
  type: 'http' as const,
  url: 'https://nas.tail1234.ts.net/mcp',
};
const tools = [{ inputSchema: { type: 'object' }, name: 'list_files' }];
const device = (deviceId: string, channels: string[], online = true, friendlyName?: string) =>
  ({
    channels: channels.map((channel) => ({ channel })),
    deviceId,
    friendlyName,
    online,
  }) as never;

describe('listMcpToolsOnDevice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deviceGateway.listMcpTools).mockResolvedValue(tools as never);
  });

  it("lists on the newest online desktop app, pinned to it, with only the auth's token fields", async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      device('offline', ['desktop'], false),
      device('laptop', ['desktop', 'cli']),
    ]);

    await expect(
      listMcpToolsOnDevice({ mcpApps: true, params, serverDB, userId: 'u1' }),
    ).resolves.toEqual(tools);

    expect(deviceGateway.listMcpTools).toHaveBeenCalledWith({
      clientKinds: ['desktop'],
      deviceId: 'laptop',
      mcpApps: true,
      params: {
        auth: { accessToken: undefined, token: 'secret', type: 'bearer' },
        headers: undefined,
        name: 'nas',
        type: 'http',
        url: params.url,
      },
      userId: 'u1',
    });
  });

  // The same device and client a tunneled call of this server runs on
  it('lists on a device with only an MCP-capable `lh connect`', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([device('devbox', ['cli'])]);
    vi.mocked(deviceGateway.readDeviceSystemInfo).mockResolvedValue({
      ok: true,
      systemInfo: { supportedToolCallTypes: ['mcp'] },
    } as never);

    await listMcpToolsOnDevice({ params, serverDB, userId: 'u1' });

    expect(deviceGateway.listMcpTools).toHaveBeenCalledWith(
      expect.objectContaining({ clientKinds: ['cli'], deviceId: 'devbox' }),
    );
  });

  it('skips an older CLI and a device whose clients are unlabelled', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      device('old-cli', ['cli']),
      device('unlabelled', []),
    ]);
    vi.mocked(deviceGateway.readDeviceSystemInfo).mockResolvedValue({
      ok: true,
      systemInfo: {},
    } as never);

    await expect(listMcpToolsOnDevice({ params, serverDB, userId: 'u1' })).rejects.toBeInstanceOf(
      McpDeviceUnavailableError,
    );
    expect(deviceGateway.listMcpTools).not.toHaveBeenCalled();
  });

  it('tells the user to open the desktop app or run `lh connect` when no device can list it', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([]);

    await expect(listMcpToolsOnDevice({ params, serverDB, userId: 'u1' })).rejects.toThrow(
      /desktop app or run `lh connect`/,
    );
  });
});

describe('resolveBoundMcpDevice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDeviceDispatchAuthorizationFailure).mockResolvedValue(undefined);
  });

  it('resolves the bound device in its pool, even when a newer device is online', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      device('newest', ['desktop']),
      device('nas-box', ['desktop']),
    ]);

    await expect(
      resolveBoundMcpDevice({
        binding: { deviceId: 'nas-box', workspaceId: 'ws1' },
        identifier: 'nas',
        serverDB,
        userId: 'u1',
      }),
    ).resolves.toEqual({ clientKinds: ['desktop'], deviceId: 'nas-box', workspaceId: 'ws1' });
    // Looked up in the workspace pool the binding names
    expect(getScopedOnlineDevices).toHaveBeenCalledWith(serverDB, 'u1', 'ws1');
  });

  it('fails as offline, naming the device, instead of falling back to another one', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      device('laptop', ['desktop']),
      device('nas-box', ['desktop'], false, 'Office NAS'),
    ]);

    const error = await resolveBoundMcpDevice({
      binding: { deviceId: 'nas-box' },
      identifier: 'nas',
      serverDB,
      userId: 'u1',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(McpBoundDeviceUnavailableError);
    expect(error.reason).toBe('offline');
    expect(error.message).toContain('"Office NAS", which is offline');
  });

  it('fails as not found when the device is gone or no longer visible', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([device('laptop', ['desktop'])]);

    await expect(
      resolveBoundMcpDevice({
        binding: { deviceId: 'gone' },
        identifier: 'nas',
        serverDB,
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ reason: 'not_found' });
  });

  it('fails as not found when the workspace registry no longer authorizes the device', async () => {
    vi.mocked(resolveDeviceDispatchAuthorizationFailure).mockResolvedValue({
      code: 'DEVICE_NOT_FOUND',
    } as never);

    await expect(
      resolveBoundMcpDevice({
        binding: { deviceId: 'nas-box', workspaceId: 'ws1' },
        identifier: 'nas',
        serverDB,
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ reason: 'not_found' });
    expect(getScopedOnlineDevices).not.toHaveBeenCalled();
  });

  it('fails as unsupported when the device only has an `lh connect` that predates MCP', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([device('old-cli', ['cli'])]);
    vi.mocked(deviceGateway.readDeviceSystemInfo).mockResolvedValue({
      ok: true,
      systemInfo: {},
    } as never);

    await expect(
      resolveBoundMcpDevice({
        binding: { deviceId: 'old-cli' },
        identifier: 'nas',
        serverDB,
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ reason: 'unsupported' });
  });
});

describe('listMcpToolsOnDevice with a bound device', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDeviceDispatchAuthorizationFailure).mockResolvedValue(undefined);
    vi.mocked(deviceGateway.listMcpTools).mockResolvedValue(tools as never);
  });

  it('lists on the bound workspace device, addressed under its workspace', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      device('newest', ['desktop']),
      device('nas-box', ['desktop']),
    ]);

    await listMcpToolsOnDevice({
      params: { ...params, boundDevice: { deviceId: 'nas-box', workspaceId: 'ws1' } },
      serverDB,
      userId: 'u1',
    });

    expect(deviceGateway.listMcpTools).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'nas-box', workspaceId: 'ws1' }),
    );
  });

  it('fails with the bound reason when the bound device is offline', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      device('laptop', ['desktop']),
      device('nas-box', ['desktop'], false),
    ]);

    await expect(
      listMcpToolsOnDevice({
        params: { ...params, boundDevice: { deviceId: 'nas-box' } },
        serverDB,
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ reason: 'offline' });
    expect(deviceGateway.listMcpTools).not.toHaveBeenCalled();
  });
});
