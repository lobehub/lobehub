import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPublicLambdaClient } from '../api/client';
import { OFFICIAL_GATEWAY_URL } from '../constants/urls';
import { loadDeviceGatewayUrl, saveDeviceGatewayUrl } from '../settings';
import {
  describeDeviceGatewayFailure,
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

  it('bounds all attempts by one deadline, including a hanging retry', async () => {
    getGlobalConfig
      .mockImplementationOnce(
        () => new Promise((_, reject) => setTimeout(() => reject(refused()), 8000)),
      )
      .mockImplementationOnce(
        (_, { signal }: { signal: AbortSignal }) =>
          new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          ),
      );

    let result: Awaited<ReturnType<typeof discoverDeviceGateway>> | undefined;
    const discovery = discoverDeviceGateway('https://self.example.com').then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(result).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('timed out'),
    });
    expect(getGlobalConfig).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await discovery;
  });

  it('does not start a retry whose delay would exceed the deadline', async () => {
    getGlobalConfig.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(refused()), 9900)),
    );

    let result: Awaited<ReturnType<typeof discoverDeviceGateway>> | undefined;
    const discovery = discoverDeviceGateway('https://self.example.com').then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(result).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('ConnectionRefused'),
    });
    expect(getGlobalConfig).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await discovery;
  });

  it('redacts HTTP credentials throughout the cause chain before displaying discovery errors', async () => {
    const serverUrl = 'https://test-user:test-password@self.example.com';
    getGlobalConfig.mockRejectedValue(
      new Error(`Request failed (${serverUrl}/trpc/lambda): invalid URL`, {
        cause: new Error('HTTPS://encoded%40user:encoded%3Apassword@proxy.example.com blocked'),
      }),
    );
    vi.mocked(loadDeviceGatewayUrl).mockReturnValue(undefined);

    const result = await resolveCliDeviceGateway({ serverUrl });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failed discovery');
    const output = JSON.stringify({
      result,
      display: describeDeviceGatewayFailure(result, serverUrl),
    });
    for (const secret of ['test-user', 'test-password', 'encoded%40user', 'encoded%3Apassword']) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('self.example.com/trpc/lambda');
    expect(output).toContain('proxy.example.com');
    expect(output).toContain('invalid URL');
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
