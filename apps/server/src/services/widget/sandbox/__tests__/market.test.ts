import { MarketAPIError } from '@lobehub/market-sdk';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/services/market', () => ({ MarketService: vi.fn() }));

const { MarketWidgetSandboxRunner } = await import('../market');
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

const setup = (run: (...args: any[]) => Promise<unknown>) => {
  const sandbox = { run: vi.fn(run) };
  const sandboxFor = vi.fn(() => sandbox as any);
  const runner = new MarketWidgetSandboxRunner({ isEnabled: () => true, sandboxFor });
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
    expect(sandboxFor).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'ws-1' });
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
    [429, { error: 'rate_limited' }, 'SANDBOX_ERROR'],
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
});
