import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appEnv = vi.hoisted(
  () => ({ APP_URL: undefined, INTERNAL_APP_URL: undefined }) as Record<string, string | undefined>,
);
vi.mock('@/envs/app', () => ({ appEnv }));

const { updateBotRuntimeStatus } = vi.hoisted(() => ({
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    starting: 'starting',
  },
  updateBotRuntimeStatus,
}));

const {
  buildSelfWebhookUrl,
  FORWARD_FAILURE_REPORT_INTERVAL_MS,
  INBOUND_FORWARD_FAILED_ERROR_CODE,
  isBotUnusableForSending,
  resolveSelfWebhookBase,
  SelfWebhookForwardMonitor,
} = await import('./selfWebhook');

const WEBHOOK_URL = 'http://localhost:3210/api/agent/webhooks/feishu/cli_app';

const refused = () =>
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNREFUSED 100.64.0.1:443'), {
      code: 'ECONNREFUSED',
    }),
  });

afterEach(() => {
  appEnv.APP_URL = undefined;
  appEnv.INTERNAL_APP_URL = undefined;
  vi.restoreAllMocks();
});

describe('resolveSelfWebhookBase', () => {
  // #23215: behind a reverse proxy / tailnet, APP_URL is the public host and
  // does not connect from inside the container; the compose file already sets
  // INTERNAL_APP_URL=http://localhost:3210 for server-to-server calls.
  it('prefers INTERNAL_APP_URL over the public app URL', () => {
    appEnv.APP_URL = 'https://lobe.tailnet.ts.net';
    appEnv.INTERNAL_APP_URL = 'http://localhost:3210';

    expect(resolveSelfWebhookBase('https://lobe.tailnet.ts.net')).toBe('http://localhost:3210');
    expect(buildSelfWebhookUrl('feishu', 'cli_app', 'https://lobe.tailnet.ts.net')).toBe(
      'http://localhost:3210/api/agent/webhooks/feishu/cli_app',
    );
  });

  it('falls back to the app URL from the runtime context, then APP_URL', () => {
    expect(resolveSelfWebhookBase('https://app.example.com')).toBe('https://app.example.com');

    appEnv.APP_URL = 'https://env.example.com';
    expect(resolveSelfWebhookBase()).toBe('https://env.example.com');
    expect(buildSelfWebhookUrl('qq', '1024', undefined)).toBe(
      'https://env.example.com/api/agent/webhooks/qq/1024',
    );
  });

  it('treats an empty INTERNAL_APP_URL as unset and trims whitespace and trailing slashes', () => {
    appEnv.INTERNAL_APP_URL = '';
    expect(resolveSelfWebhookBase(' https://app.example.com// ')).toBe('https://app.example.com');

    appEnv.INTERNAL_APP_URL = 'http://lobe:3210/';
    expect(buildSelfWebhookUrl('slack', 'A1', 'https://app.example.com')).toBe(
      'http://lobe:3210/api/agent/webhooks/slack/A1',
    );
  });
});

describe('SelfWebhookForwardMonitor', () => {
  let now = 0;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  const createMonitor = () =>
    new SelfWebhookForwardMonitor({
      applicationId: 'cli_app',
      now: () => now,
      platform: 'feishu',
      ttlMs: 1000,
      webhookUrl: WEBHOOK_URL,
    });

  const statusWrites = () => updateBotRuntimeStatus.mock.calls.map(([params]) => params);

  beforeEach(() => {
    now = 1_000_000;
    updateBotRuntimeStatus.mockClear();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('logs an unreachable loopback at error level and marks the bot failed', async () => {
    const monitor = createMonitor();

    await monitor.record({ error: refused(), ok: false });

    expect(monitor.consecutiveFailures).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain('[bot-platform:feishu]');
    expect(line).toContain('cli_app');
    expect(line).toContain(WEBHOOK_URL);
    expect(line).toContain('(ECONNREFUSED)');
    expect(line).toContain('1 dropped in a row');
    expect(line).toContain('INTERNAL_APP_URL');

    expect(updateBotRuntimeStatus).toHaveBeenCalledWith(
      {
        applicationId: 'cli_app',
        errorCode: INBOUND_FORWARD_FAILED_ERROR_CODE,
        errorMessage: expect.stringContaining('cannot pass them on to this server (ECONNREFUSED)'),
        platform: 'feishu',
        status: 'failed',
      },
      { redisClient: undefined, ttlMs: 1000 },
    );
    // The status line is shown to the bot owner: no internal address in it.
    expect(statusWrites()[0].errorMessage).not.toContain('localhost:3210/api');
    expect(statusWrites()[0].errorMessage).toContain('INTERNAL_APP_URL');
  });

  it('reports a rejected forward with its HTTP status', async () => {
    const monitor = createMonitor();

    await monitor.record({ ok: false, status: 401 });

    expect(String(errorSpy.mock.calls[0][0])).toContain('failed (HTTP 401)');
    expect(statusWrites()[0]).toMatchObject({
      errorCode: INBOUND_FORWARD_FAILED_ERROR_CODE,
      errorMessage: expect.stringContaining('rejected them when they were passed on (HTTP 401)'),
      status: 'failed',
    });
  });

  it('names a timeout instead of the abort message', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });

    await createMonitor().record({ error: timeout, ok: false });

    expect(String(errorSpy.mock.calls[0][0])).toContain('failed (timed out)');
  });

  it('counts every drop and logs the first at once, the rest at most once a minute', async () => {
    const monitor = createMonitor();

    await monitor.record({ error: refused(), ok: false });
    now += 1000;
    await monitor.record({ error: refused(), ok: false });
    await monitor.record({ error: refused(), ok: false });

    expect(monitor.consecutiveFailures).toBe(3);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    now += FORWARD_FAILURE_REPORT_INTERVAL_MS;
    await monitor.record({ error: refused(), ok: false });

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(String(errorSpy.mock.calls[1][0])).toContain('4 dropped in a row');
  });

  it('re-writes the failed status on every drop, so a concurrent connected write cannot hide it', async () => {
    const monitor = createMonitor();

    await monitor.record({ error: refused(), ok: false });
    await monitor.record({ error: refused(), ok: false });

    expect(statusWrites().map((params) => params.status)).toEqual(['failed', 'failed']);
  });

  it('returns the bot to connected with the first event that gets through again', async () => {
    const monitor = createMonitor();

    await monitor.record({ error: refused(), ok: false });
    await monitor.record({ error: refused(), ok: false });
    await monitor.record({ ok: true, status: 200 });

    expect(monitor.consecutiveFailures).toBe(0);
    expect(statusWrites().at(-1)).toEqual({
      applicationId: 'cli_app',
      platform: 'feishu',
      status: 'connected',
    });
    expect(String(infoSpy.mock.calls[0][0])).toContain('again after 2 dropped in a row');

    // A new failure after recovery is reported at once, not throttled by the old one.
    await monitor.record({ error: refused(), ok: false });
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('writes nothing while forwarding is healthy', async () => {
    const monitor = createMonitor();

    await monitor.record({ ok: true, status: 200 });
    await monitor.record({ ok: true, status: 200 });

    expect(updateBotRuntimeStatus).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('stays quiet once disposed, so a late result cannot overwrite the stop status', async () => {
    const monitor = createMonitor();

    monitor.dispose();
    await monitor.record({ error: refused(), ok: false });

    expect(updateBotRuntimeStatus).not.toHaveBeenCalled();
  });

  it('drops a queued status write when disposed before it runs', async () => {
    let releaseFirst!: () => void;
    updateBotRuntimeStatus.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseFirst = resolve)),
    );
    const monitor = createMonitor();

    const first = monitor.record({ error: refused(), ok: false });
    const recovered = monitor.record({ ok: true, status: 200 });
    await vi.waitFor(() => expect(updateBotRuntimeStatus).toHaveBeenCalledTimes(1));
    monitor.dispose();
    releaseFirst();
    await Promise.all([first, recovered]);

    expect(statusWrites().map((params) => params.status)).toEqual(['failed']);
  });

  it('never throws when the status write fails', async () => {
    updateBotRuntimeStatus.mockRejectedValueOnce(new Error('redis down'));

    await expect(createMonitor().record({ error: refused(), ok: false })).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls.at(-1)?.[0])).toContain('Could not record');
  });
});

describe('isBotUnusableForSending', () => {
  it('rules out a failed bot', () => {
    expect(isBotUnusableForSending({ status: 'failed' })).toBe(true);
    expect(isBotUnusableForSending({ errorCode: 'session_expired', status: 'failed' })).toBe(true);
  });

  it('keeps a bot that only fails to hand inbound messages over: sending does not use that leg', () => {
    expect(
      isBotUnusableForSending({ errorCode: INBOUND_FORWARD_FAILED_ERROR_CODE, status: 'failed' }),
    ).toBe(false);
    expect(isBotUnusableForSending({ status: 'connected' })).toBe(false);
  });
});
