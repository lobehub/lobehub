import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPublicLambdaClient } from '../api/client';
import { OFFICIAL_GATEWAY_URL } from '../constants/urls';
import { loadDeviceGatewayUrl, saveDeviceGatewayUrl } from '../settings';
import {
  discoverDeviceGateway,
  rememberGatewayOverride,
  resolveCliDeviceGateway,
} from './gatewayEndpoint';

const getGlobalConfig = vi.fn();
vi.mock('../api/client', () => ({
  createPublicLambdaClient: vi.fn(() => ({
    config: { getGlobalConfig: { query: getGlobalConfig } },
  })),
}));
vi.mock('../settings', () => ({
  loadDeviceGatewayUrl: vi.fn(),
  saveDeviceGatewayUrl: vi.fn(),
}));

const refused = () =>
  Object.assign(new Error('Unable to connect'), {
    cause: Object.assign(new Error('fetch failed'), { code: 'ConnectionRefused' }),
  });

describe('discoverDeviceGateway', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getGlobalConfig.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks the given server, anonymously', async () => {
    getGlobalConfig.mockResolvedValue({
      serverConfig: { deviceGatewayUrl: 'https://gw.example.com' },
    });

    await expect(discoverDeviceGateway('https://self.example.com')).resolves.toEqual({
      status: 'advertised',
      url: 'https://gw.example.com',
    });
    expect(createPublicLambdaClient).toHaveBeenCalledWith('https://self.example.com');
  });

  it('rides out a transient network failure on the same server', async () => {
    getGlobalConfig.mockRejectedValueOnce(refused()).mockResolvedValueOnce({ serverConfig: {} });

    const discovery = discoverDeviceGateway('https://self.example.com');
    await vi.runAllTimersAsync();

    await expect(discovery).resolves.toEqual({ status: 'absent' });
    expect(getGlobalConfig).toHaveBeenCalledTimes(2);
  });

  it('reports the cause once retries are exhausted', async () => {
    getGlobalConfig.mockRejectedValue(refused());

    const discovery = discoverDeviceGateway('https://self.example.com');
    await vi.runAllTimersAsync();

    await expect(discovery).resolves.toEqual({
      reason: expect.stringContaining('ConnectionRefused'),
      status: 'failed',
    });
    expect(getGlobalConfig).toHaveBeenCalledTimes(4);
  });

  it('does not retry an error answer', async () => {
    getGlobalConfig.mockRejectedValue(new Error('INTERNAL_SERVER_ERROR'));

    await expect(discoverDeviceGateway('https://self.example.com')).resolves.toMatchObject({
      status: 'failed',
    });
    expect(getGlobalConfig).toHaveBeenCalledTimes(1);
  });
});

describe('resolveCliDeviceGateway', () => {
  beforeEach(() => {
    getGlobalConfig.mockReset();
    vi.mocked(loadDeviceGatewayUrl).mockReset();
  });

  it('uses --gateway ahead of the saved address, without asking the server', async () => {
    vi.mocked(loadDeviceGatewayUrl).mockReturnValue('https://gw.saved.example');

    await expect(
      resolveCliDeviceGateway({
        override: 'https://gw.flag.example/',
        serverUrl: 'https://self.example.com',
      }),
    ).resolves.toEqual({
      endpoint: { source: 'override', url: 'https://gw.flag.example' },
      ok: true,
    });
    expect(getGlobalConfig).not.toHaveBeenCalled();
  });

  it("uses the credential server's saved address ahead of its advertisement, without asking", async () => {
    getGlobalConfig.mockResolvedValue({
      serverConfig: { deviceGatewayUrl: 'https://gw.advertised.example' },
    });
    vi.mocked(loadDeviceGatewayUrl).mockReturnValue('https://gw.saved.example');

    await expect(
      resolveCliDeviceGateway({ serverUrl: 'https://self.example.com' }),
    ).resolves.toEqual({
      endpoint: { source: 'manual', url: 'https://gw.saved.example' },
      ok: true,
    });
    expect(loadDeviceGatewayUrl).toHaveBeenCalledWith('https://self.example.com');
    expect(getGlobalConfig).not.toHaveBeenCalled();
  });

  it('uses the advertised address when nothing is saved', async () => {
    getGlobalConfig.mockResolvedValue({
      serverConfig: { deviceGatewayUrl: 'https://gw.advertised.example/edge/' },
    });

    await expect(
      resolveCliDeviceGateway({ serverUrl: 'https://self.example.com' }),
    ).resolves.toEqual({
      endpoint: { source: 'server', url: 'https://gw.advertised.example/edge' },
      ok: true,
    });
  });

  it('keeps the official gateway as the default for official cloud only', async () => {
    getGlobalConfig.mockResolvedValue({ serverConfig: {} });

    await expect(
      resolveCliDeviceGateway({ serverUrl: 'https://app.lobehub.com' }),
    ).resolves.toEqual({ endpoint: { source: 'official', url: OFFICIAL_GATEWAY_URL }, ok: true });
    await expect(
      resolveCliDeviceGateway({ serverUrl: 'https://self.example.com' }),
    ).resolves.toEqual({ ok: false, reason: 'not_configured' });
  });

  it('does not use the official default when the lookup fails', async () => {
    getGlobalConfig.mockRejectedValue(new Error('INTERNAL_SERVER_ERROR'));

    await expect(
      resolveCliDeviceGateway({ serverUrl: 'https://app.lobehub.com' }),
    ).resolves.toMatchObject({ ok: false, reason: 'discovery_failed' });
  });
});

describe('rememberGatewayOverride', () => {
  beforeEach(() => {
    vi.mocked(loadDeviceGatewayUrl).mockReset();
    vi.mocked(saveDeviceGatewayUrl).mockReset();
  });

  const override = { source: 'override' as const, url: 'https://gw.example.com' };

  it.each([
    ['a self-hosted server', 'https://self.example.com'],
    ['official cloud', 'https://app.lobehub.com'],
  ])('saves --gateway as the address of %s', (_label, serverUrl) => {
    expect(rememberGatewayOverride(serverUrl, override)).toBe(true);
    expect(saveDeviceGatewayUrl).toHaveBeenCalledWith(serverUrl, override.url);
  });

  it('saves nothing for an unchanged, saved, advertised or default address', () => {
    vi.mocked(loadDeviceGatewayUrl).mockReturnValue(override.url);
    expect(rememberGatewayOverride('https://self.example.com', override)).toBe(false);

    vi.mocked(loadDeviceGatewayUrl).mockReturnValue(undefined);
    for (const source of ['manual', 'server', 'official'] as const) {
      expect(rememberGatewayOverride('https://self.example.com', { ...override, source })).toBe(
        false,
      );
    }
    expect(saveDeviceGatewayUrl).not.toHaveBeenCalled();
  });
});
