import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  exchangeManagedDeviceToken,
  getManagedTokenRefreshDelay,
  getManagedTokenRetryDelay,
  ManagedTokenFatalError,
  ManagedTokenSession,
  readManagedDeviceConfig,
  readManagedTokenPrincipal,
} from './managed';

const jwt = (payload: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    expect(result).toEqual({
      message: 'LOBEHUB_SERVER is not an https URL (http is allowed only for localhost).',
      ok: false,
    });
  });

  it('rejects plain http to a remote host', () => {
    const result = readManagedDeviceConfig({
      ...FULL_ENV,
      LOBEHUB_DEVICE_GATEWAY_URL: 'http://gateway.example.com',
    });
    expect(result).toEqual({
      message:
        'LOBEHUB_DEVICE_GATEWAY_URL is not an https URL (http is allowed only for localhost).',
      ok: false,
    });
  });

  it.each(['http://localhost:3010', 'http://127.0.0.1:3010', 'http://[::1]:3010'])(
    'accepts plain http to this machine (%s)',
    (server) => {
      expect(readManagedDeviceConfig({ ...FULL_ENV, LOBEHUB_SERVER: server })).toMatchObject({
        config: { serverUrl: server },
        ok: true,
      });
    },
  );

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

const CONFIG = {
  deviceId: 'device-1',
  secret: 'top-secret',
  serverUrl: 'https://app.example.com',
};

describe('exchangeManagedDeviceToken', () => {
  const call = (response: Response | Error) => {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
    return exchangeManagedDeviceToken(CONFIG);
  };

  it('posts the device id and secret to the token route', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const result = await call(
      Response.json({ expiresAt: '2030-01-01T00:00:00.000Z', token: 'tok' }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
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

  it('treats a lifetime above 24 h as malformed and refreshes after 5 min', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(getManagedTokenRefreshDelay({ expiresAt: day, issuedAt: 0, token: 't' })).toBe(
      day * 0.8,
    );
    expect(getManagedTokenRefreshDelay({ expiresAt: day + 1, issuedAt: 0, token: 't' })).toBe(
      300_000,
    );
    expect(
      getManagedTokenRefreshDelay({ expiresAt: Number.MAX_SAFE_INTEGER, issuedAt: 0, token: 't' }),
    ).toBe(300_000);
  });

  it('doubles from 1 s to a 60 s cap with ±20% jitter', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect([1, 2, 3, 6, 7, 20].map((n) => getManagedTokenRetryDelay(n))).toEqual([
      1000, 2000, 4000, 32_000, 60_000, 60_000,
    ]);
    random.mockReturnValue(0);
    expect(getManagedTokenRetryDelay(1)).toBe(800);
    random.mockReturnValue(1);
    expect(getManagedTokenRetryDelay(1)).toBe(1200);
  });
});

describe('ManagedTokenSession', () => {
  const HOUR = 3_600_000;
  let onToken: ReturnType<typeof vi.fn>;
  let onFatal: ReturnType<typeof vi.fn>;

  // The token route's answers, one per call. The token lives one hour from
  // the moment it is fetched.
  const issued = (token: string) => async () =>
    Response.json({ expiresAt: new Date(Date.now() + HOUR).toISOString(), token });
  const httpStatus = (status: number) => async () => new Response('{}', { status });
  const networkError = async () => {
    throw new TypeError('fetch failed');
  };

  const createSession = () =>
    new ManagedTokenSession({
      config: CONFIG,
      logger: { debug: vi.fn(), warn: vi.fn() },
      onFatal,
      onToken,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    onToken = vi.fn();
    onFatal = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes at 80% of the lifetime and keeps doing so', async () => {
    fetchMock
      .mockImplementationOnce(issued('t1'))
      .mockImplementationOnce(issued('t2'))
      .mockImplementationOnce(issued('t3'));
    const session = createSession();

    expect((await session.start()).token).toBe('t1');
    expect(onToken).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0.8 * HOUR - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onToken).toHaveBeenLastCalledWith(expect.objectContaining({ token: 't2' }));

    await vi.advanceTimersByTimeAsync(0.8 * HOUR);
    expect(onToken).toHaveBeenLastCalledWith(expect.objectContaining({ token: 't3' }));
    session.stop();
  });

  it('retries 5xx and network failures with backoff', async () => {
    fetchMock
      .mockImplementationOnce(httpStatus(503))
      .mockImplementationOnce(networkError)
      .mockImplementationOnce(issued('t1'));
    const session = createSession();
    const started = session.start();

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((await started).token).toBe('t1');
    session.stop();
  });

  it('rejects start on a 401 without retrying', async () => {
    fetchMock.mockImplementation(httpStatus(401));
    const session = createSession();

    await expect(session.start()).rejects.toBeInstanceOf(ManagedTokenFatalError);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a 401 during a scheduled refresh through onFatal', async () => {
    fetchMock.mockImplementationOnce(issued('t1')).mockImplementation(httpStatus(401));
    const session = createSession();
    await session.start();

    await vi.advanceTimersByTimeAsync(0.8 * HOUR);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0].message).toContain('HTTP 401');
    expect(onToken).not.toHaveBeenCalled();
  });

  it('keeps retrying a failing scheduled refresh until the server answers', async () => {
    fetchMock
      .mockImplementationOnce(issued('t1'))
      .mockImplementationOnce(httpStatus(500))
      .mockImplementationOnce(httpStatus(500))
      .mockImplementationOnce(issued('t2'));
    const session = createSession();
    await session.start();

    await vi.advanceTimersByTimeAsync(0.8 * HOUR + 1000 + 2000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(onToken).toHaveBeenCalledWith(expect.objectContaining({ token: 't2' }));
    expect(onFatal).not.toHaveBeenCalled();
    session.stop();
  });

  it('refreshNow replaces the scheduled refresh and shares one exchange', async () => {
    fetchMock.mockImplementationOnce(issued('t1')).mockImplementationOnce(issued('t2'));
    const session = createSession();
    await session.start();

    const [a, b] = await Promise.all([session.refreshNow(), session.refreshNow()]);
    expect(a.token).toBe('t2');
    expect(b.token).toBe('t2');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The old schedule is gone; the next refresh is 80% after t2.
    fetchMock.mockImplementationOnce(issued('t3'));
    await vi.advanceTimersByTimeAsync(0.8 * HOUR);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    session.stop();
  });

  it('stops retrying once stopped', async () => {
    fetchMock.mockImplementation(httpStatus(500));
    const session = createSession();
    const started = session.start();
    await vi.advanceTimersByTimeAsync(0);

    session.stop();
    await expect(started).rejects.toThrow(/stopped/);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
