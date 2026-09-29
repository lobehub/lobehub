import { describe, expect, it, vi } from 'vitest';

import {
  DASHBOARD_SANDBOX_DEFAULT_TIMEOUT_MS,
  DASHBOARD_SANDBOX_MAX_TIMEOUT_MS,
  DashboardSandboxError,
  DashboardSandboxRunner,
} from '../sandboxRunner';

const URL = 'https://sandbox.example.workers.dev/';
const TOKEN = 'test-token';

const respond = (status: number, body: unknown) =>
  vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status,
      }),
  );

const runnerWith = (fetchImpl: ReturnType<typeof vi.fn>) =>
  new DashboardSandboxRunner({
    fetch: fetchImpl as unknown as typeof fetch,
    token: TOKEN,
    url: URL,
  });

describe('DashboardSandboxRunner', () => {
  it('posts the script to /run with the bearer token and returns the streams', async () => {
    const fetchImpl = respond(200, {
      durationMs: 42,
      exitCode: 0,
      runtime: 'node',
      stderr: '',
      stdout: '{"type":"stat","value":1}',
    });

    const result = await runnerWith(fetchImpl).run({
      env: { GITHUB_TOKEN: 'secret' },
      network: true,
      runtime: 'node',
      script: 'console.log(1)',
      timeoutMs: 10_000,
    });

    expect(result).toEqual({
      durationMs: 42,
      exitCode: 0,
      stderr: '',
      stdout: '{"type":"stat","value":1}',
      timedOut: false,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sandbox.example.workers.dev/run');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      env: { GITHUB_TOKEN: 'secret' },
      network: true,
      runtime: 'node',
      script: 'console.log(1)',
      timeoutMs: 10_000,
    });
  });

  it('defaults and clamps the timeout to what the Worker accepts', async () => {
    const fetchImpl = respond(200, { exitCode: 0, stderr: '', stdout: '' });
    const runner = runnerWith(fetchImpl);

    await runner.run({ runtime: 'bash', script: 'true' });
    await runner.run({ runtime: 'bash', script: 'true', timeoutMs: 10 * 60_000 });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      env: {},
      network: false,
      timeoutMs: DASHBOARD_SANDBOX_DEFAULT_TIMEOUT_MS,
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).timeoutMs).toBe(
      DASHBOARD_SANDBOX_MAX_TIMEOUT_MS,
    );
  });

  it('reports a non-zero exit as a result, not an error', async () => {
    const result = await runnerWith(
      respond(200, { durationMs: 5, exitCode: 3, stderr: 'oops', stdout: '' }),
    ).run({ runtime: 'bash', script: 'exit 3' });

    expect(result).toMatchObject({ exitCode: 3, stderr: 'oops', timedOut: false });
  });

  it('maps the Worker timeout answer to timedOut', async () => {
    const result = await runnerWith(
      respond(200, {
        durationMs: 1000,
        error: 'timeout',
        exitCode: 124,
        message: 'Command timed out',
        stderr: '',
        stdout: '',
      }),
    ).run({ runtime: 'bash', script: 'sleep 999', timeoutMs: 1000 });

    expect(result).toMatchObject({ exitCode: 124, timedOut: true });
  });

  it('fails clearly when the sandbox is not configured', async () => {
    const fetchImpl = vi.fn();
    const runner = new DashboardSandboxRunner({ fetch: fetchImpl as unknown as typeof fetch });

    expect(runner.isConfigured).toBe(false);
    await expect(runner.run({ runtime: 'node', script: 'x' })).rejects.toMatchObject({
      code: 'SANDBOX_NOT_CONFIGURED',
      message: expect.stringContaining('DASHBOARD_SANDBOX_URL'),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, { error: 'unauthorized' }, 'SANDBOX_UNAUTHORIZED'],
    [400, { error: '`runtime` must be one of node | python | bash' }, 'SANDBOX_BAD_REQUEST'],
    [500, { error: 'execution_failed', message: 'container crashed' }, 'SANDBOX_ERROR'],
  ])('throws DashboardSandboxError on HTTP %i', async (status, body, code) => {
    const error = await runnerWith(respond(status, body))
      .run({ runtime: 'node', script: 'x' })
      .catch((e) => e);

    expect(error).toBeInstanceOf(DashboardSandboxError);
    expect(error.code).toBe(code);
  });

  it('never leaks the token into the error message', async () => {
    const error = await runnerWith(respond(401, { error: 'unauthorized' }))
      .run({ runtime: 'node', script: 'x' })
      .catch((e) => e);

    expect(error.message).not.toContain(TOKEN);
  });

  it('wraps network failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(runnerWith(fetchImpl).run({ runtime: 'node', script: 'x' })).rejects.toMatchObject(
      {
        code: 'SANDBOX_ERROR',
        message: 'Sandbox request failed: fetch failed',
      },
    );
  });

  it('rejects an unreadable response body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));

    await expect(runnerWith(fetchImpl).run({ runtime: 'node', script: 'x' })).rejects.toMatchObject(
      {
        code: 'SANDBOX_ERROR',
      },
    );
  });
});
