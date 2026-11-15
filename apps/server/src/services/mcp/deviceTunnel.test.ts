import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import { listMcpToolsOnPersonalDevice, McpDeviceUnavailableError } from './deviceTunnel';

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

const serverDB = {} as never;
const params = {
  auth: { refreshToken: 'never-leaves', token: 'secret', type: 'bearer' as const },
  name: 'nas',
  type: 'http' as const,
  url: 'https://nas.tail1234.ts.net/mcp',
};
const tools = [{ inputSchema: { type: 'object' }, name: 'list_files' }];
const device = (deviceId: string, channels: string[], online = true) =>
  ({ channels: channels.map((channel) => ({ channel })), deviceId, online }) as never;

describe('listMcpToolsOnPersonalDevice', () => {
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
      listMcpToolsOnPersonalDevice({ mcpApps: true, params, serverDB, userId: 'u1' }),
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

    await listMcpToolsOnPersonalDevice({ params, serverDB, userId: 'u1' });

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

    await expect(
      listMcpToolsOnPersonalDevice({ params, serverDB, userId: 'u1' }),
    ).rejects.toBeInstanceOf(McpDeviceUnavailableError);
    expect(deviceGateway.listMcpTools).not.toHaveBeenCalled();
  });

  it('tells the user to open the desktop app or run `lh connect` when no device can list it', async () => {
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([]);

    await expect(listMcpToolsOnPersonalDevice({ params, serverDB, userId: 'u1' })).rejects.toThrow(
      /desktop app or run `lh connect`/,
    );
  });
});
