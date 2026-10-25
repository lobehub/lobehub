import { MarketAPIError } from '@lobehub/market-sdk';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/services/market', () => ({ MarketService: vi.fn() }));

const { MarketService } = await import('@/server/services/market');
const { resolveSandboxRunLimits } = await import('@/business/server/sandboxRun');
const { MarketWidgetSandboxRunner, marketRetryAfterMs } = await import('../market');
const { WIDGET_SANDBOX_DEFAULT_TIMEOUT_MS, WIDGET_SANDBOX_MAX_TIMEOUT_MS } =
  await import('../types');

const request = {
  actor: { userId: 'user-1', workspaceId: 'ws-1' },
  env: { REPO: 'lobehub/lobehub' },
  network: { allow: ['api.github.com'] },
  runtime: 'node' as const,
  script: 'console.log("ok")',
  subject: { id: 'widget-1', kind: 'widget' as const },
};

const result = {
  durationMs: 1800,
  exitCode: 0,
  runId: 'run-1',
  stderr: '',
  stdout: '{"type":"stat"}',
  timedOut: false,
  truncated: false,
};

const setup = (
  run: (...args: any[]) => Promise<unknown>,
  resolveLimits?: (...args: any[]) => Promise<{ maxConcurrency: number } | null>,
) => {
  const sandbox = { run: vi.fn(run) };
  const sandboxFor = vi.fn((..._args: any[]) => sandbox as any);
  const runner = new MarketWidgetSandboxRunner({
    isEnabled: () => true,
    resolveLimits,
    sandboxFor,
  });
  return { runner, sandbox, sandboxFor };
};

const apiError = (status: number, body?: unknown) =>
  new MarketAPIError(status, 'Error', body as any);

describe('MarketWidgetSandboxRunner', () => {
  it('runs through the Market SDK as the widget actor and maps the result', async () => {
    const { runner, sandbox, sandboxFor } = setup(async () => result);

    await expect(runner.run(request)).resolves.toEqual({
      durationMs: 1800,
      exitCode: 0,
      stderr: '',
      stdout: '{"type":"stat"}',
      timedOut: false,
    });
    // The open-source hook grants nothing: Market's default concurrency applies.
    expect(sandboxFor).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'ws-1' }, null);
    expect(sandbox.run).toHaveBeenCalledWith(
      {
        egress: { allow: ['api.github.com'] },
        env: { REPO: 'lobehub/lobehub' },
        runtime: 'node',
        script: 'console.log("ok")',
        subject: { id: 'widget-1', kind: 'widget' },
        timeoutMs: WIDGET_SANDBOX_DEFAULT_TIMEOUT_MS,
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('forwards credential injects to the egress proxy without putting secrets in env', async () => {
    const { runner, sandbox } = setup(async () => result);
    const inject = [
      {
        header: 'Authorization',
        host: 'api.github.com',
        prefix: 'Bearer ',
        secretRef: { key: 'github' },
      },
    ];

    await runner.run({
      ...request,
      env: { GITHUB_TOKEN: 'lh_ph_placeholder' },
      network: { allow: ['api.github.com'], inject },
    });

    expect(sandbox.run.mock.calls[0][0]).toMatchObject({
      egress: { allow: ['api.github.com'], inject },
      env: { GITHUB_TOKEN: 'lh_ph_placeholder' },
    });
  });

  it('clamps the timeout and keeps non-zero exits and timeouts as results', async () => {
    const { runner, sandbox } = setup(async () => ({ ...result, exitCode: 124, timedOut: true }));

    await expect(runner.run({ ...request, timeoutMs: 999_999 })).resolves.toMatchObject({
      exitCode: 124,
      timedOut: true,
    });
    expect(sandbox.run.mock.calls[0][0].timeoutMs).toBe(WIDGET_SANDBOX_MAX_TIMEOUT_MS);
  });

  it('fails as not configured without trusted-client credentials, without calling Market', async () => {
    const sandboxFor = vi.fn();
    const runner = new MarketWidgetSandboxRunner({ isEnabled: () => false, sandboxFor });

    await expect(runner.run(request)).rejects.toMatchObject({ code: 'SANDBOX_NOT_CONFIGURED' });
    expect(sandboxFor).not.toHaveBeenCalled();
  });

  it.each([
    [503, { error: 'sandbox_not_configured' }, 'SANDBOX_NOT_CONFIGURED'],
    [401, { error: 'invalid_token' }, 'SANDBOX_UNAUTHORIZED'],
    [403, { error: 'forbidden_client' }, 'SANDBOX_UNAUTHORIZED'],
    [400, { error: 'invalid_request', error_description: 'bad host' }, 'SANDBOX_BAD_REQUEST'],
    [422, { error: 'secret_unusable' }, 'SANDBOX_BAD_REQUEST'],
    [429, { error: 'rate_limited' }, 'SANDBOX_BUSY'],
    [429, { error: 'concurrency_limited' }, 'SANDBOX_BUSY'],
    [429, undefined, 'SANDBOX_BUSY'],
    [503, { error: 'sandbox_unavailable' }, 'SANDBOX_ERROR'],
    [500, undefined, 'SANDBOX_ERROR'],
  ])('maps HTTP %d %j to %s', async (status, body, code) => {
    const { runner } = setup(async () => {
      throw apiError(status, body);
    });

    await expect(runner.run(request)).rejects.toMatchObject({ code, name: 'WidgetSandboxError' });
  });

  it('keeps Market’s error code and description in the message', async () => {
    const { runner } = setup(async () => {
      throw apiError(400, { error: 'invalid_request', error_description: 'bad host' });
    });

    await expect(runner.run(request)).rejects.toMatchObject({
      message: expect.stringContaining('invalid_request: bad host'),
    });
  });

  it('turns a network failure into SANDBOX_ERROR', async () => {
    const { runner } = setup(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(runner.run(request)).rejects.toMatchObject({
      code: 'SANDBOX_ERROR',
      message: expect.stringContaining('fetch failed'),
    });
  });

  describe('account limits (429)', () => {
    // Production incident: four widgets of one account due in the same minute;
    // two ran and two closed as terminal SANDBOX_ERROR until their next slot.
    it('turns concurrency_limited into a retryable SANDBOX_BUSY with Market’s 5 s backoff', async () => {
      const { runner } = setup(async () => {
        throw apiError(429, {
          error: 'concurrency_limited',
          error_description: 'Too many concurrent sandbox runs',
        });
      });

      await expect(runner.run(request)).rejects.toMatchObject({
        code: 'SANDBOX_BUSY',
        message: expect.stringContaining('concurrency_limited'),
        retryAfterMs: 5000,
      });
    });

    it('waits out the rest of Market’s epoch-aligned minute for rate_limited', () => {
      const error = apiError(429, { error: 'rate_limited' });
      expect(marketRetryAfterMs(error, 'rate_limited', 60_000 * 1000 + 45_000)).toBe(15_000);
      // Never less than a second, even at the very end of the window.
      expect(marketRetryAfterMs(error, 'rate_limited', 60_000 * 1000 + 59_999)).toBe(1000);
    });

    it('prefers a retry_after hint in the body, capped at a minute', () => {
      expect(
        marketRetryAfterMs(
          apiError(429, { error: 'rate_limited', retry_after: 7 }),
          'rate_limited',
        ),
      ).toBe(7000);
      expect(
        marketRetryAfterMs(
          apiError(429, { error: 'x', retry_after: '2.5' }),
          'concurrency_limited',
        ),
      ).toBe(2500);
      expect(
        marketRetryAfterMs(apiError(429, { error: 'x', retry_after: 3600 }), 'rate_limited'),
      ).toBe(60_000);
      expect(
        marketRetryAfterMs(apiError(429, { error: 'x', retry_after: -1 }), 'concurrency_limited'),
      ).toBe(5000);
    });
  });

  describe('plan-based concurrency claim', () => {
    it('defaults to no claim in the open-source build', async () => {
      await expect(
        resolveSandboxRunLimits({ userId: 'user-1', workspaceId: 'ws-1' }),
      ).resolves.toBe(null);
    });

    it('resolves the limits for the run’s actor and hands them to the Market client', async () => {
      const resolveLimits = vi.fn(async () => ({ maxConcurrency: 5 }));
      const { runner, sandboxFor } = setup(async () => result, resolveLimits);

      await runner.run(request);

      expect(resolveLimits).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'ws-1' });
      expect(sandboxFor).toHaveBeenCalledWith(
        { userId: 'user-1', workspaceId: 'ws-1' },
        { maxConcurrency: 5 },
      );
    });

    it('runs without a claim when the lookup fails or answers something Market would reject', async () => {
      for (const resolveLimits of [
        vi.fn(async () => {
          throw new Error('billing down');
        }),
        vi.fn(async () => ({ maxConcurrency: 0 })),
        vi.fn(async () => ({ maxConcurrency: 2.5 })),
      ]) {
        const { runner, sandboxFor } = setup(async () => result, resolveLimits);
        await expect(runner.run(request)).resolves.toMatchObject({ exitCode: 0 });
        expect(sandboxFor).toHaveBeenCalledWith(expect.anything(), null);
      }
    });

    it('signs the claim onto the actor’s trusted-client token by default', async () => {
      const run = vi.fn(async () => result);
      vi.mocked(MarketService).mockImplementation(function () {
        return { market: { sandbox: { run } } } as any;
      });
      const runner = new MarketWidgetSandboxRunner({
        isEnabled: () => true,
        resolveLimits: async () => ({ maxConcurrency: 5 }),
      });

      await runner.run(request);

      expect(MarketService).toHaveBeenCalledWith({
        userInfo: { sandboxRun: { maxConcurrency: 5 }, userId: 'user-1', workspaceId: 'ws-1' },
      });
      expect(run).toHaveBeenCalledTimes(1);
    });
  });
});
