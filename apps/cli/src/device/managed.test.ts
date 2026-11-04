import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  exchangeManagedDeviceToken,
  getManagedTokenRefreshDelay,
  getManagedTokenRetryDelay,
  type ManagedTokenExchangeResult,
  ManagedTokenFatalError,
  ManagedTokenSession,
  readManagedDeviceConfig,
  readManagedTokenPrincipal,
} from './managed';

const jwt = (payload: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

const FULL_ENV = {
  LOBEHUB_DEVICE_GATEWAY_URL: 'https://gateway.example.com/',
  LOBEHUB_MANAGED_DEVICE_ID: 'device-1',
  LOBEHUB_MANAGED_DEVICE_SECRET: 'top-secret',
  LOBEHUB_SERVER: 'https://app.example.com/',
};

describe('readManagedDeviceConfig', () => {
  it('reads every variable and trims trailing slashes from URLs', () => {
    expect(
      readManagedDeviceConfig({
        ...FULL_ENV,
        LOBEHUB_DEVICE_ACTIVITY_COMMAND: 'report-activity --device "a b"',
      }),
    ).toEqual({
      config: {
        activityCommand: 'report-activity --device "a b"',
        deviceId: 'device-1',
        gatewayUrl: 'https://gateway.example.com',
        secret: 'top-secret',
        serverUrl: 'https://app.example.com',
      },
      ok: true,
    });
  });

  it('names every missing variable', () => {
    const result = readManagedDeviceConfig({
      LOBEHUB_MANAGED_DEVICE_ID: 'device-1',
      LOBEHUB_SERVER: '  ',
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toBe(
      '--managed needs these environment variables, which are not set: LOBEHUB_MANAGED_DEVICE_SECRET, LOBEHUB_SERVER, LOBEHUB_DEVICE_GATEWAY_URL.',
    );
  });

  it('rejects a non-http URL without printing any value', () => {
    const result = readManagedDeviceConfig({ ...FULL_ENV, LOBEHUB_SERVER: 'ftp://top-secret' });
    expect(result).toEqual({ message: 'LOBEHUB_SERVER is not an http(s) URL.', ok: false });
  });

  it('rejects an activity command that cannot be split', () => {
    const result = readManagedDeviceConfig({
      ...FULL_ENV,
      LOBEHUB_DEVICE_ACTIVITY_COMMAND: 'report "unclosed',
    });
    expect(result).toEqual({
      message: 'LOBEHUB_DEVICE_ACTIVITY_COMMAND could not be parsed: unterminated " quote.',
      ok: false,
    });
  });

  it('never puts the secret in a failure message', () => {
    const result = readManagedDeviceConfig({ ...FULL_ENV, LOBEHUB_DEVICE_GATEWAY_URL: undefined });
    expect(JSON.stringify(result)).not.toContain('top-secret');
  });
});

describe('exchangeManagedDeviceToken', () => {
  const call = (response: Response | Error) =>
    exchangeManagedDeviceToken({
      deviceId: 'device-1',
      fetchImpl: vi.fn(async () => {
        if (response instanceof Error) throw response;
        return response;
      }) as unknown as typeof fetch,
      now: () => 1000,
      secret: 'top-secret',
      serverUrl: 'https://app.example.com',
    });

  it('posts the device id and secret to the token route', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ expiresAt: '2030-01-01T00:00:00.000Z', token: 'tok' }),
    );
    const result = await exchangeManagedDeviceToken({
      deviceId: 'device-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
      secret: 'top-secret',
      serverUrl: 'https://app.example.com',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://app.example.com/api/device/managed/token',
      expect.objectContaining({
        body: JSON.stringify({ deviceId: 'device-1', secret: 'top-secret' }),
        method: 'POST',
      }),
    );
    expect(result).toEqual({
      expiresAt: Date.parse('2030-01-01T00:00:00.000Z'),
      issuedAt: 1000,
      status: 'issued',
      token: 'tok',
    });
  });

  it('measures the lifetime on the server clock when the server sends Date', async () => {
    const response = Response.json(
      { expiresAt: '2030-01-01T01:00:00.000Z', token: 'tok' },
      { headers: { Date: 'Tue, 01 Jan 2030 00:00:00 GMT' } },
    );
    const result = await call(response);
    expect(result).toMatchObject({ issuedAt: Date.parse('2030-01-01T00:00:00.000Z') });
    // A local clock far ahead of the server still refreshes at 80% of an hour.
    expect(getManagedTokenRefreshDelay(result as any)).toBe(2_880_000);
  });

  it.each([
    [401, { status: 'invalid-credentials' }],
    [404, { status: 'unavailable' }],
    [400, { httpStatus: 400, status: 'rejected' }],
    [413, { httpStatus: 413, status: 'rejected' }],
    [429, { reason: 'HTTP 429', status: 'retryable' }],
    [500, { reason: 'HTTP 500', status: 'retryable' }],
    [503, { reason: 'HTTP 503', status: 'retryable' }],
  ])('maps HTTP %i', async (status, expected) => {
    expect(await call(new Response('{}', { status }))).toEqual(expected);
  });

  it('retries a network error', async () => {
    expect(await call(new TypeError('fetch failed'))).toEqual({
      reason: 'fetch failed',
      status: 'retryable',
    });
  });

  it('retries an unreadable 200 body', async () => {
    expect(await call(new Response('<html>', { status: 200 }))).toMatchObject({
      status: 'retryable',
    });
    expect(await call(Response.json({ token: 'tok' }))).toMatchObject({ status: 'retryable' });
  });
});

describe('readManagedTokenPrincipal', () => {
  it('uses workspace_id for a workspace device', () => {
    expect(readManagedTokenPrincipal(jwt({ sub: 'ws-1', workspace_id: 'ws-1' }))).toEqual({
      workspaceId: 'ws-1',
    });
  });

  it('uses sub for a personal device', () => {
    expect(readManagedTokenPrincipal(jwt({ sub: 'user-1' }))).toEqual({ userId: 'user-1' });
  });

  it('throws on a token without a principal', () => {
    expect(() => readManagedTokenPrincipal(jwt({}))).toThrow(/no sub or workspace_id/);
    expect(() => readManagedTokenPrincipal('not-a-jwt')).toThrow(/not a JWT/);
  });
});

describe('refresh and retry delays', () => {
  it('refreshes at 80% of the lifetime, at least 5 s', () => {
    expect(getManagedTokenRefreshDelay({ expiresAt: 3_600_000, issuedAt: 0, token: 't' })).toBe(
      2_880_000,
    );
    expect(getManagedTokenRefreshDelay({ expiresAt: 1000, issuedAt: 0, token: 't' })).toBe(5000);
    expect(getManagedTokenRefreshDelay({ expiresAt: 0, issuedAt: 1000, token: 't' })).toBe(5000);
  });

  it('doubles from 1 s to a 60 s cap with ±20% jitter', () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 6, 7, 20].map((n) => getManagedTokenRetryDelay(n, mid))).toEqual([
      1000, 2000, 4000, 32_000, 60_000, 60_000,
    ]);
    expect(getManagedTokenRetryDelay(1, () => 0)).toBe(800);
    expect(getManagedTokenRetryDelay(1, () => 1)).toBe(1200);
  });
});

describe('ManagedTokenSession', () => {
  const HOUR = 3_600_000;
  let exchange: ReturnType<typeof vi.fn<() => Promise<ManagedTokenExchangeResult>>>;
  let onToken: ReturnType<typeof vi.fn>;
  let onFatal: ReturnType<typeof vi.fn>;

  const issued = (token: string): ManagedTokenExchangeResult => ({
    expiresAt: Date.now() + HOUR,
    issuedAt: Date.now(),
    status: 'issued',
    token,
  });

  const createSession = () =>
    new ManagedTokenSession({
      config: { deviceId: 'device-1', secret: 'top-secret', serverUrl: 'https://app.example.com' },
      exchange,
      logger: { debug: vi.fn(), warn: vi.fn() },
      onFatal,
      onToken,
      random: () => 0.5,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    exchange = vi.fn<() => Promise<ManagedTokenExchangeResult>>();
    onToken = vi.fn();
    onFatal = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes at 80% of the lifetime and keeps doing so', async () => {
    exchange
      .mockResolvedValueOnce(issued('t1'))
      .mockResolvedValueOnce(issued('t2'))
      .mockResolvedValueOnce(issued('t3'));
    const session = createSession();

    expect((await session.start()).token).toBe('t1');
    expect(onToken).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0.8 * HOUR - 1);
    expect(exchange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onToken).toHaveBeenLastCalledWith(expect.objectContaining({ token: 't2' }));

    await vi.advanceTimersByTimeAsync(0.8 * HOUR);
    expect(onToken).toHaveBeenLastCalledWith(expect.objectContaining({ token: 't3' }));
    session.stop();
  });

  it('retries 5xx and network failures with backoff', async () => {
    exchange
      .mockResolvedValueOnce({ reason: 'HTTP 503', status: 'retryable' })
      .mockResolvedValueOnce({ reason: 'fetch failed', status: 'retryable' })
      .mockResolvedValueOnce(issued('t1'));
    const session = createSession();
    const started = session.start();

    await vi.advanceTimersByTimeAsync(999);
    expect(exchange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(exchange).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(exchange).toHaveBeenCalledTimes(3);
    expect((await started).token).toBe('t1');
    session.stop();
  });

  it('rejects start on a 401 without retrying', async () => {
    exchange.mockResolvedValue({ status: 'invalid-credentials' });
    const session = createSession();

    await expect(session.start()).rejects.toBeInstanceOf(ManagedTokenFatalError);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('reports a 401 during a scheduled refresh through onFatal', async () => {
    exchange.mockResolvedValueOnce(issued('t1')).mockResolvedValue({
      status: 'invalid-credentials',
    });
    const session = createSession();
    await session.start();

    await vi.advanceTimersByTimeAsync(0.8 * HOUR);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0].message).toContain('HTTP 401');
    expect(onToken).not.toHaveBeenCalled();
  });

  it('keeps retrying a failing scheduled refresh until the server answers', async () => {
    exchange
      .mockResolvedValueOnce(issued('t1'))
      .mockResolvedValueOnce({ reason: 'HTTP 500', status: 'retryable' })
      .mockResolvedValueOnce({ reason: 'HTTP 500', status: 'retryable' })
      .mockResolvedValueOnce(issued('t2'));
    const session = createSession();
    await session.start();

    await vi.advanceTimersByTimeAsync(0.8 * HOUR + 1000 + 2000);
    expect(exchange).toHaveBeenCalledTimes(4);
    expect(onToken).toHaveBeenCalledWith(expect.objectContaining({ token: 't2' }));
    expect(onFatal).not.toHaveBeenCalled();
    session.stop();
  });

  it('refreshNow replaces the scheduled refresh and shares one exchange', async () => {
    exchange.mockResolvedValueOnce(issued('t1')).mockResolvedValueOnce(issued('t2'));
    const session = createSession();
    await session.start();

    const [a, b] = await Promise.all([session.refreshNow(), session.refreshNow()]);
    expect(a.token).toBe('t2');
    expect(b.token).toBe('t2');
    expect(exchange).toHaveBeenCalledTimes(2);

    // The old schedule is gone; the next refresh is 80% after t2.
    exchange.mockResolvedValueOnce(issued('t3'));
    await vi.advanceTimersByTimeAsync(0.8 * HOUR);
    expect(exchange).toHaveBeenCalledTimes(3);
    session.stop();
  });

  it('stops retrying once stopped', async () => {
    exchange.mockResolvedValue({ reason: 'HTTP 500', status: 'retryable' });
    const session = createSession();
    const started = session.start();
    await vi.advanceTimersByTimeAsync(0);

    session.stop();
    await expect(started).rejects.toThrow(/stopped/);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(exchange).toHaveBeenCalledTimes(1);
  });
});
