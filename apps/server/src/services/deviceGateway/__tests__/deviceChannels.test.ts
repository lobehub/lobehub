import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryDeviceListMock = vi.fn();
const readDeviceSystemInfoMock = vi.fn();
vi.mock('../index', () => ({
  deviceGateway: {
    queryDeviceList: (...args: unknown[]) => queryDeviceListMock(...args),
    readDeviceSystemInfo: (...args: unknown[]) => readDeviceSystemInfoMock(...args),
  },
}));

const { resolveDeviceClientKind, resolveMcpClientKinds } = await import('../deviceChannels');

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
