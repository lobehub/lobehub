import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryDeviceListMock = vi.fn();
vi.mock('../index', () => ({
  deviceGateway: {
    queryDeviceList: (...args: unknown[]) => queryDeviceListMock(...args),
  },
}));

const { resolveDeviceClientKind } = await import('../deviceChannels');

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
