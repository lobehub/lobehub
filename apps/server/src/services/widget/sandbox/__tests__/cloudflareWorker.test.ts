import { describe, expect, it, vi } from 'vitest';

import { CloudflareWorkerSandboxRunner } from '../cloudflareWorker';
import {
  WIDGET_SANDBOX_DEFAULT_TIMEOUT_MS,
  WIDGET_SANDBOX_MAX_TIMEOUT_MS,
  WidgetSandboxError,
  type WidgetSandboxRunRequest,
} from '../types';

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

const runnerWith = (fetchImpl: ReturnType<typeof vi.fn>, networkFormat?: 'allowlist' | 'boolean') =>
  new CloudflareWorkerSandboxRunner({
    fetch: fetchImpl as unknown as typeof fetch,
    networkFormat,
    token: TOKEN,
    url: URL,
  });

const request = (overrides: Partial<WidgetSandboxRunRequest> = {}): WidgetSandboxRunRequest => ({
  env: {},
  network: { allow: [] },
  runtime: 'node',
  script: 'x',
  subject: { id: 'widget-1', kind: 'widget' },
  ...overrides,
});

describe('CloudflareWorkerSandboxRunner', () => {
  it('posts the script with the full network allowlist and returns the streams', async () => {
    const fetchImpl = respond(200, {
      durationMs: 42,
      exitCode: 0,
      stderr: '',
      stdout: '{"type":"stat","value":1}',
    });

    const result = await runnerWith(fetchImpl).run(
      request({
        env: { GITHUB_TOKEN: 'secret' },
        network: { allow: ['api.github.com', 'gitlab.com'] },
        script: 'console.log(1)',
        timeoutMs: 10_000,
      }),
    );

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
      network: { allow: ['api.github.com', 'gitlab.com'] },
      runtime: 'node',
      script: 'console.log(1)',
      timeoutMs: 10_000,
    });
  });

  it('collapses the allowlist to a boolean for a Worker that only understands on/off', async () => {
    const fetchImpl = respond(200, { exitCode: 0, stderr: '', stdout: '' });
    const runner = runnerWith(fetchImpl, 'boolean');

    await runner.run(request({ network: { allow: ['api.github.com'] } }));
    await runner.run(request());

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).network).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).network).toBe(false);
  });

  it('defaults and clamps the timeout to what the Worker accepts', async () => {
    const fetchImpl = respond(200, { exitCode: 0, stderr: '', stdout: '' });
    const runner = runnerWith(fetchImpl);

    await runner.run(request());
    await runner.run(request({ timeoutMs: 10 * 60_000 }));

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      network: { allow: [] },
      timeoutMs: WIDGET_SANDBOX_DEFAULT_TIMEOUT_MS,
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).timeoutMs).toBe(
      WIDGET_SANDBOX_MAX_TIMEOUT_MS,
    );
  });

  it('reports a non-zero exit as a result, not an error', async () => {
    const result = await runnerWith(
      respond(200, { durationMs: 5, exitCode: 3, stderr: 'oops', stdout: '' }),
    ).run(request({ runtime: 'bash', script: 'exit 3' }));

    expect(result).toMatchObject({ exitCode: 3, stderr: 'oops', timedOut: false });
  });

  it('maps the Worker timeout answer to timedOut', async () => {
    const result = await runnerWith(
      respond(200, { durationMs: 1000, error: 'timeout', message: 'Command timed out' }),
    ).run(request({ timeoutMs: 1000 }));

    expect(result).toMatchObject({ exitCode: 124, timedOut: true });
  });

  it('fails clearly when the sandbox is not configured', async () => {
    const fetchImpl = vi.fn();
    const runner = new CloudflareWorkerSandboxRunner({
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(runner.isConfigured).toBe(false);
    await expect(runner.run(request())).rejects.toMatchObject({
      code: 'SANDBOX_NOT_CONFIGURED',
      message: expect.stringContaining('WIDGET_SANDBOX_URL'),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, { error: 'unauthorized' }, 'SANDBOX_UNAUTHORIZED'],
    [400, { error: '`runtime` must be one of node | python | bash' }, 'SANDBOX_BAD_REQUEST'],
    [500, { error: 'execution_failed', message: 'container crashed' }, 'SANDBOX_ERROR'],
  ])('throws WidgetSandboxError on HTTP %i', async (status, body, code) => {
    const error = await runnerWith(respond(status, body))
      .run(request())
      .catch((e) => e);

    expect(error).toBeInstanceOf(WidgetSandboxError);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain(TOKEN);
  });

  it('wraps network failures and unreadable bodies', async () => {
    await expect(
      runnerWith(vi.fn().mockRejectedValue(new TypeError('fetch failed'))).run(request()),
    ).rejects.toMatchObject({
      code: 'SANDBOX_ERROR',
      message: 'Sandbox request failed: fetch failed',
    });
    await expect(
      runnerWith(
        vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 })),
      ).run(request()),
    ).rejects.toMatchObject({ code: 'SANDBOX_ERROR' });
  });
});
