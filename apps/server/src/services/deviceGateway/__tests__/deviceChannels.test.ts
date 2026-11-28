import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryDeviceListMock = vi.fn();
const readDeviceSystemInfoMock = vi.fn();
vi.mock('../index', () => ({
  deviceGateway: {
    queryDeviceList: (...args: unknown[]) => queryDeviceListMock(...args),
    readDeviceSystemInfo: (...args: unknown[]) => readDeviceSystemInfoMock(...args),
  },
}));

const rememberFeaturesMock = vi.fn(async (_scope: unknown, fetch: () => Promise<unknown>) =>
  fetch(),
);
vi.mock('@/server/services/redis', () => ({
  redisService: { mcpDeviceRelay: { rememberFeatures: rememberFeaturesMock } },
}));

const { resolveDeviceClientKind, resolveMcpClientKinds, resolveMcpDeviceFeatures } =
  await import('../deviceChannels');

const withChannels = (...channels: string[]) => [
  { channels: channels.map((channel) => ({ channel })), deviceId: 'device-1' },
];

describe('resolveDeviceClientKind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a device whose only clients are the desktop app as desktop', async () => {
    queryDeviceListMock.mockResolvedValueOnce(withChannels('desktop', 'desktop-dev'));
    await expect(resolveDeviceClientKind('user-1', 'device-1')).resolves.toBe('desktop');
  });

  it('reports desktop plus `lh connect` as mixed, since the gateway prefers the CLI', async () => {
    queryDeviceListMock.mockResolvedValueOnce(withChannels('cli', 'desktop'));
    await expect(resolveDeviceClientKind('user-1', 'device-1', 'ws-1')).resolves.toBe('mixed');
    expect(queryDeviceListMock).toHaveBeenCalledWith('user-1', 'ws-1');
  });

  it('reports a device with only CLI channels as cli-only', async () => {
    queryDeviceListMock.mockResolvedValueOnce(withChannels('cli', 'cli-dev'));
    await expect(resolveDeviceClientKind('user-1', 'device-1')).resolves.toBe('cli-only');
  });

  it('reports unknown when the device is absent or the lookup fails', async () => {
    queryDeviceListMock.mockResolvedValueOnce([]);
    await expect(resolveDeviceClientKind('user-1', 'device-1')).resolves.toBe('unknown');

    queryDeviceListMock.mockRejectedValueOnce(new Error('gateway down'));
    await expect(resolveDeviceClientKind('user-1', 'device-1')).resolves.toBe('unknown');
  });
});

describe('resolveMcpClientKinds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pins the call to the desktop app whenever it is connected, without asking the CLI', async () => {
    queryDeviceListMock.mockResolvedValueOnce(withChannels('cli', 'desktop'));
    await expect(resolveMcpClientKinds('user-1', 'device-1')).resolves.toEqual(['desktop']);
    await expect(
      resolveMcpClientKinds('user-1', 'device-1', undefined, 'unknown'),
    ).resolves.toEqual(['desktop']);
    expect(readDeviceSystemInfoMock).not.toHaveBeenCalled();
  });

  it('routes to lh connect when that CLI says it runs MCP calls', async () => {
    queryDeviceListMock.mockResolvedValueOnce(withChannels('cli'));
    readDeviceSystemInfoMock.mockResolvedValueOnce({
      ok: true,
      systemInfo: { supportedToolCallTypes: ['tool', 'mcp'] },
    });

    await expect(resolveMcpClientKinds('user-1', 'device-1', 'ws-1')).resolves.toEqual(['cli']);
    expect(readDeviceSystemInfoMock).toHaveBeenCalledWith('user-1', 'device-1', 'ws-1', {
      clientKinds: ['cli'],
    });
  });

  it('refuses a CLI that predates MCP support, or that did not answer', async () => {
    readDeviceSystemInfoMock.mockResolvedValueOnce({
      ok: true,
      systemInfo: { supportedTools: [] },
    });
    await expect(
      resolveMcpClientKinds('user-1', 'device-1', undefined, 'cli-only'),
    ).resolves.toBeUndefined();

    readDeviceSystemInfoMock.mockResolvedValueOnce({ ok: false, reason: 'TIMEOUT' });
    await expect(
      resolveMcpClientKinds('user-1', 'device-1', undefined, 'cli-only'),
    ).resolves.toBeUndefined();
  });
});

describe('resolveMcpDeviceFeatures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the MCP features of the client that runs the calls, in its pool', async () => {
    readDeviceSystemInfoMock.mockResolvedValueOnce({
      ok: true,
      systemInfo: { supportedMcpFeatures: ['apps'], supportedToolCallTypes: ['tool', 'mcp'] },
    });
    const target = { clientKinds: ['cli' as const], deviceId: 'device-1', workspaceId: 'ws-1' };

    await expect(resolveMcpDeviceFeatures('user-1', target)).resolves.toEqual(['apps']);
    expect(readDeviceSystemInfoMock).toHaveBeenCalledWith('user-1', 'device-1', 'ws-1', {
      clientKinds: ['cli'],
    });
    expect(rememberFeaturesMock).toHaveBeenCalledWith(
      { clientKinds: ['cli'], deviceId: 'device-1', userId: 'user-1', workspaceId: 'ws-1' },
      expect.any(Function),
    );
  });

  it('reports none for an older client, or one that does not answer', async () => {
    const target = { clientKinds: ['desktop' as const], deviceId: 'device-1' };
    readDeviceSystemInfoMock.mockResolvedValueOnce({ ok: true, systemInfo: {} });
    await expect(resolveMcpDeviceFeatures('user-1', target)).resolves.toEqual([]);

    readDeviceSystemInfoMock.mockResolvedValueOnce({ ok: false, reason: 'TIMEOUT' });
    await expect(resolveMcpDeviceFeatures('user-1', target)).resolves.toEqual([]);
  });
});
